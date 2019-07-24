import Debug from 'debug';
import express, { Express } from 'express';
import http from 'http';
import get from 'lodash/get';
import bluebird from 'bluebird';
import { createTerminus, TerminusOptions } from '@godaddy/terminus';

import config from './config';
import * as docs from './route/openapi/openapiDocs';
import responseHandler from './express/middlewares/responseHandler';
import errorHandler from './express/middlewares/errorHandler';
import notFoundHandler from './express/middlewares/notFoundHandler';
import { execBootScripts } from './express/boot';
import { IOfBaseExpress } from './index';

const debug = Debug('of-base-api');

interface IOptionsHealthChecks {
	livenessEndpoint?: string;
	readynessEndpoint?: string;
}

interface IOptions {
	version?: string | number;
	boot?: {
		dirPath?: string;
	};
	healthChecks?: IOptionsHealthChecks;
	openapi?: {
		docs?: {
			path: string;
			options?: any;
		};
		ui: {
			path: string;
			options?: any;
		};
	};
}

type CreateAppArgs = [] | [Function] | [Express, Function] | [Express, IOptions, Function];

export const processArgs = (...args) => {
	/*
		options are either
		createApp(runMiddlewares) -> Promise
		createApp(app, runMiddlewares) -> Promise
		createApp(app, options, runMiddlewares) -> Promise
	*/

	let [app, options, runMiddlewares] = args;

	if (args.length === 0) {
		// createApp()
		app = express();
	} else if (args.length === 1) {
		// createApp(runMiddlewares)
		runMiddlewares = app;
		app = express();
	} else if (args.length === 2) {
		// createApp(app, runMiddlewares)
		runMiddlewares = options;
	}
	if (!options) options = {};
	if (!runMiddlewares) runMiddlewares = () => {};
	// if (args.length === 3) then no change

	// for 3 arguments then we can assume app, options and callback are set
	return [app, options, runMiddlewares];
};

export const configureExpress = async (app, options: IOptions = {}, runMiddlewares?) => {
	// this is at the start
	app.use(express.json({ limit: '1mb' }));
	app.use(express.urlencoded({ extended: true }));

	// middlewares
	if (runMiddlewares) await runMiddlewares(app);

	// swaggern
	const { path: openapiDocsPath, options: openapiDocsOpts } = get(options, 'openapi.docs', {});
	if (openapiDocsPath) {
		const fullSwaggerDoc = docs.generateFullSwagger(openapiDocsOpts);
		// tslint:disable-next-line:variable-name
		app.get(openapiDocsPath, (_req, res) => res.json(fullSwaggerDoc));

		const { path: swaggerUIPath, options: swaggerUIOpts } = get(options, 'openapi.docs', {});
		if (swaggerUIPath) {
			const swaggerUi = require('swagger-ui-express');
			app.use('/explorer', swaggerUi.serve, swaggerUi.setup(fullSwaggerDoc, swaggerUIOpts));
		}
	}

	app.use(responseHandler());
	app.use(notFoundHandler());
	app.use(errorHandler());

	return app;
};

export const configureTerminus = (app, healthChecks: IOptionsHealthChecks = {}) => {
	const terminusOptions: TerminusOptions = {
		onSignal: async () => {
			const jobs = app.locals.onSignalJobs || [];
			return bluebird.map<Function, any>(jobs, c => c());
		}
	};

	terminusOptions.healthChecks = {};

	if (healthChecks.readynessEndpoint) {
		terminusOptions.healthChecks[healthChecks.readynessEndpoint] = async () => {
			const checks = app.locals.readynessChecks || [];
			return bluebird.map<Function, any>(checks, c => c());
		};
	}

	if (healthChecks.livenessEndpoint) {
		terminusOptions.healthChecks[healthChecks.livenessEndpoint] = async () => {
			const checks = app.locals.livenessChecks || [];
			return bluebird.map<Function, any>(checks, c => c());
		};
	}

	return createTerminus(app.server, terminusOptions);
};

export const createApp = (...args: CreateAppArgs): Promise<IOfBaseExpress> => {
	// process the arguments
	const [app, options, addMiddlewares] = processArgs(...args);

	app.start = async () => {
		debug('run the boot executions');
		await execBootScripts(app, options.boot);

		debug('create the server');
		const server = http.createServer(app);
		app.server = server;

		debug('configure terminus');
		await configureTerminus(app, options.healthChecks);

		await new Promise(resolve =>
			server.listen(config.PORT, () => {
				console.log(`Server listening on ${config.PORT}`);
				resolve();
			})
		);

		return { app, server };
	};

	app.close = () => {
		if (app.server) {
			return app.server.close();
		}

		console.warn('Server not initialised, ignoring');
	};

	app.registerReadynessCheck = fn => {
		app.locals.readynessChecks = app.locals.readynessChecks || [];
		app.locals.readynessChecks.push(fn);
	};

	app.registerLivenessCheck = fn => {
		app.locals.livenessChecks = app.locals.livenessChecks || [];
		app.locals.livenessChecks.push(fn);
	};

	app.registerOnSignalJob = fn => {
		app.locals.onSignalJobs = app.locals.onSignalJobs || [];
		app.locals.onSignalJobs.push(fn);
	};

	debug('configure the express app');
	return configureExpress(app, options, addMiddlewares);
};
