/*
 * © Copyright 2022 HP Development Company, L.P.
 * SPDX-License-Identifier: MIT
 */

import { di, EntityRegistry, JSONSchema, mapObject, mapSeries } from '@davinci/core';
import Ajv, { DefinedError, Options, Plugin } from 'ajv';
import addFormats from 'ajv-formats';
import { TypeValue } from '@davinci/reflector';
import { EndpointSchema, ParameterConfiguration, Route, ValidationFactory, ValidationFunction } from './types';
import { BadRequest } from './httpErrors';

const defaultAjvOptions: Options = {
	removeAdditional: 'all',
	coerceTypes: 'array',
	allErrors: true,
	useDefaults: true
};

const sources = ['path', 'header', 'query', 'body'] as const;
type Source = typeof sources[number];
type AjvInstancesMap = Record<Source, Ajv>;
type AjvOptionsMap = Record<Source, Options>;

type AjvPluginOptions = unknown;
type AjvPlugin = Plugin<AjvPluginOptions>;
type AjvPlugins = Array<[AjvPlugin, AjvPluginOptions?]>;
type AjvPluginsMap = Record<Source, AjvPlugins>;

export interface AjvValidatorOptions {
	ajvOptions?: Options | Partial<AjvOptionsMap>;
	plugins?: AjvPlugins | Partial<AjvPluginsMap>;
}

@di.autoInjectable()
export class AjvValidator<Request = unknown> {
	private ajvInstances?: Partial<AjvInstancesMap> = {};
	private jsonSchemasMap = new Map<TypeValue, JSONSchema>();

	private sourceToSchemaMap: Partial<
		Record<ParameterConfiguration<Request>['source'], keyof EndpointSchema['properties']>
	> = {
		path: 'params',
		query: 'querystring',
		header: 'headers',
		body: 'body'
	};

	constructor(private options: AjvValidatorOptions, private entityRegistry?: EntityRegistry) {
		this.initializeInstances();
		this.registerPlugins();
	}

	public async createValidatorFunction(route: Route<Request>): Promise<ValidationFunction> {
		const { parametersConfig } = route;
		const endpointSchema = await this.createSchema(parametersConfig);

		const validateFns = sources.reduce((acc, source) => {
			const schema = endpointSchema.properties[this.sourceToSchemaMap[source]];
			if (schema) {
				const validateFn = this.ajvInstances[source].compile(schema);
				acc.push({
					source,
					validateFn
				});
			}

			return acc;
		}, []);

		return async (data: unknown) => {
			const errors = [];
			validateFns.forEach(({ source, validateFn }) => {
				const dataPath = data?.[this.sourceToSchemaMap[source]];
				if (!validateFn(dataPath)) {
					errors.push(...validateFn.errors.map(error => this.formatAjvError(source, error)));
				}
			});

			if (errors.length) {
				throw new BadRequest('Validation error', {
					errors
				});
			}
		};
	}

	async createSchema(parametersConfig: ParameterConfiguration<Request>[]): Promise<EndpointSchema> {
		const endpointSchema: EndpointSchema = {
			type: 'object',
			properties: {},
			required: []
		};

		await mapSeries(parametersConfig, parameterConfig => {
			if (
				parameterConfig.source === 'context' ||
				parameterConfig.source === 'request' ||
				parameterConfig.source === 'response'
			)
				return;

			const enabledValidation = !parameterConfig.options?.validation?.disabled;

			const entityJsonSchema = this.entityRegistry.getJsonSchema(parameterConfig.type);
			const entityDefinition = this.entityRegistry.getEntityDefinitionMap().get(parameterConfig.type);

			const jsonSchema = this.jsonSchemasMap.get(parameterConfig.type) ?? this.createJsonSchema(entityJsonSchema);
			if (!this.jsonSchemasMap.has(entityDefinition) && jsonSchema.$id) {
				this.jsonSchemasMap.set(entityDefinition, jsonSchema);
				this.addSchemaToAjvInstances(jsonSchema);
			}

			if (['path', 'query', 'header'].includes(parameterConfig.source)) {
				const schemaProp = this.sourceToSchemaMap[parameterConfig.source];

				endpointSchema.properties[schemaProp] = endpointSchema.properties[schemaProp] ?? {
					type: 'object',
					properties: {},
					required: undefined
				};
				endpointSchema.properties[schemaProp].properties[parameterConfig.name] = enabledValidation
					? jsonSchema
					: true;
				endpointSchema.properties[schemaProp].required = endpointSchema.properties[schemaProp].required ?? [];
				if (enabledValidation && parameterConfig.options?.required) {
					endpointSchema.properties[schemaProp].required.push(parameterConfig.name);
				}
			}

			if (parameterConfig.source === 'body') {
				const jsonSchemaDef = jsonSchema?.$id ? { $ref: jsonSchema.$id } : jsonSchema;
				endpointSchema.properties.body = enabledValidation ? jsonSchemaDef : true;
				endpointSchema.required = endpointSchema.required ?? [];
				if (enabledValidation && parameterConfig.options?.required) {
					endpointSchema.required.push('body');
				}
			}
		});

		return endpointSchema;
	}

	public getAjvInstances() {
		return this.ajvInstances;
	}

	public getOptions() {
		return this.options;
	}

	private formatAjvError(source: Source, error: DefinedError) {
		const rootPath = this.sourceToSchemaMap[source];
		error.instancePath = error.instancePath.replace(/(^\/)|(^$)/, `/${rootPath}$1`);
		error.schemaPath = error.schemaPath.replace(/^#\/properties\//, `#/${rootPath}/properties/`);

		return error;
	}

	private initializeInstances() {
		sources.forEach(source => {
			const ajv = new Ajv({
				...defaultAjvOptions,
				...(this.options?.ajvOptions?.[source] || this.options?.ajvOptions)
			});
			this.ajvInstances[source] = addFormats(ajv);
		});
	}

	private isPluginsMap = (plugins: AjvPlugins | Partial<AjvPluginsMap>): plugins is AjvPluginsMap => {
		return !Array.isArray(plugins);
	}

	private registerPlugins() {
		const plugins = this.options?.plugins;
		if (!plugins) return;

		sources.forEach(source => {
			if (this.isPluginsMap(plugins)) {
				// eslint-disable-next-line no-unused-expressions
				(plugins[source] as AjvPlugins)?.forEach(p => {
					const [plugin, opts] = p;
					plugin(this.ajvInstances[source], opts);
				});
			} else {
				(plugins as AjvPlugins).forEach(p => {
					const [plugin, opts] = p;
					plugin(this.ajvInstances[source], opts);
				});
			}
		});
	}

	private addSchemaToAjvInstances(schema: Partial<JSONSchema>) {
		const completedAjvInstances = new Set();

		sources.forEach(source => {
			const ajv = this.ajvInstances[source];
			if (!completedAjvInstances.has(ajv) && !ajv.getSchema(schema.$id)) {
				ajv.addSchema(schema);
				completedAjvInstances.add(ajv);
			}
		});
	}

	private createJsonSchema(jsonSchema: Partial<JSONSchema>) {
		return {
			...(jsonSchema.title ? { $id: jsonSchema.title } : {}),
			...mapObject<Partial<JSONSchema>>(jsonSchema, (p, key) => {
				if (key === 'properties' && p) {
					return mapObject(p, propValue => {
						if (propValue._$ref) {
							const refEntityDefinitionJson = this.createJsonSchema(
								this.jsonSchemasMap.get(propValue._$ref) ?? propValue._$ref?.getJsonSchema()
							);

							if (!this.jsonSchemasMap.has(propValue._$ref)) {
								this.jsonSchemasMap.set(propValue._$ref, refEntityDefinitionJson);
								this.addSchemaToAjvInstances(refEntityDefinitionJson);
							}

							return { $ref: refEntityDefinitionJson.$id };
						}

						if (propValue.type === 'array' && propValue.items?._$ref) {
							const $ref = propValue.items?._$ref;
							const refEntityDefinitionJson = this.createJsonSchema(
								this.jsonSchemasMap.get($ref) ?? $ref?.getJsonSchema()
							);

							if (!this.jsonSchemasMap.has($ref)) {
								this.jsonSchemasMap.set($ref, refEntityDefinitionJson);
								this.addSchemaToAjvInstances(refEntityDefinitionJson);
							}

							return { ...propValue, items: { $ref: refEntityDefinitionJson.$id } };
						}

						return propValue;
					});
				}

				if (key === 'items' && p._$ref) {
					const $ref = p._$ref;
					const refEntityDefinitionJson = this.createJsonSchema(
						this.jsonSchemasMap.get($ref) ?? $ref?.getJsonSchema()
					);

					if (!this.jsonSchemasMap.has($ref)) {
						this.jsonSchemasMap.set($ref, refEntityDefinitionJson);
						this.addSchemaToAjvInstances(refEntityDefinitionJson);
					}

					return { $ref: refEntityDefinitionJson.$id };
				}

				return p;
			})
		};
	}
}

export const createAjvValidator = (options?: AjvValidatorOptions): ValidationFactory => {
	const ajvValidator = new AjvValidator(options);

	return route => ajvValidator.createValidatorFunction(route);
};
