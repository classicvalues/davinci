import _fp from 'lodash/fp';
import _ from 'lodash';
import { GraphQLNonNull } from 'graphql';
import { getSchema } from './generateSchema';

export const createResolver = Controller => {
	const { queries, schemas: queriesSchemas } = createResolversAndSchemas(Controller, 'queries', {});
	const { mutations, schemas } = createResolversAndSchemas(Controller, 'mutations', queriesSchemas);

	return { queries, mutations, schemas };
};

export const createResolversAndSchemas = (Controller, resolversType: 'queries' | 'mutations', schemas?) => {
	const resolversMetadata = Reflect.getMetadata(`tsgraphql:${resolversType}`, Controller.prototype) || [];
	const controllerArgs = _fp.flow(
		_fp.sortBy('index'),
		_fp.compact
	)(Reflect.getMetadata('tsgraphql:args', Controller.prototype) || []);

	const allSchemas = schemas || {};
	const controller = new Controller();

	const resolvers = resolversMetadata.reduce((acc, query) => {
		const { methodName, name, returnType } = query;
		const resolverArgsMetadata = _.filter(controllerArgs, { methodName });
		const { schema: graphqlReturnType, schemas } = getSchema(returnType, allSchemas);
		_.merge(allSchemas, schemas);

		const { resolverArgs, handlerArgsDefinition } = resolverArgsMetadata.reduce(
			(acc, arg: any) => {
				const { type, name, opts } = arg;

				const { required = false } = opts || {};
				let graphqlArgType = type;
				if (type === 'context') {
					acc.handlerArgsDefinition.push({ name, isContext: true });
					return acc;
				}

				const { schema: gArgType } = getSchema(type, allSchemas, { isInput: true });
				graphqlArgType = required ? GraphQLNonNull(gArgType) : gArgType;

				acc.resolverArgs[name] = { type: graphqlArgType };
				acc.handlerArgsDefinition.push({ name });
				return acc;
			},
			{ resolverArgs: {}, handlerArgsDefinition: [] }
		);

		acc[name || methodName] = {
			type: graphqlReturnType,
			args: resolverArgs,
			resolve(_, args, context) {
				const handlerArgs = handlerArgsDefinition.map(({ name, isContext }) => {
					if (isContext) return context;

					return (args || {})[name];
				});
				return controller[methodName](...handlerArgs);
			}
		};

		return acc;
	}, {});

	return { [resolversType]: resolvers, schemas: allSchemas };
};

export default createResolver;
