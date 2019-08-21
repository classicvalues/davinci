import _ from 'lodash';
import { ReturnTypeFunc, ReturnTypeFuncValue } from '../types';

/**
 * It annotates a variable as schema prop
 * @param opts
 */
export function field(opts?: { type?: any; required?: boolean }) {
	// this is the decorator factory
	return function(target: Object, key: string | symbol): void {
		// this is the decorator

		// get the existing metadata props
		const props = Reflect.getMetadata('tsgraphql:fields', target) || [];
		props.push({ key, opts });
		// define new metadata props
		Reflect.defineMetadata('tsgraphql:fields', props, target);
	};
}

/**
 * Decorator that annotate a query method
 * @param name
 * @param returnType
 */
export const query = (returnType: ReturnTypeFunc | ReturnTypeFuncValue, name?: string): Function => {
	return function(target: Object, methodName: string | symbol) {
		const queries = Reflect.getMetadata('tsgraphql:queries', target) || [];
		queries.unshift({ name, methodName, returnType, handler: target[methodName] });

		Reflect.defineMetadata('tsgraphql:queries', queries, target);
	};
};

/**
 * Decorator that annotate a mutation method
 * @param name
 * @param returnType
 */
export const mutation = (returnType: ReturnTypeFunc | ReturnTypeFuncValue, name?: string): Function => {
	return function(target: Object, methodName: string | symbol) {
		const mutations = Reflect.getMetadata('tsgraphql:mutations', target) || [];
		mutations.unshift({ name, methodName, returnType, handler: target[methodName] });

		Reflect.defineMetadata('tsgraphql:mutations', mutations, target);
	};
};

/**
 * Decorator that annotate a method parameter
 * @param name
 * @param opts
 */
export function arg(name, opts?): Function {
	return function(target: Object, methodName: string, index) {
		// get the existing metadata props
		const methodParameters = Reflect.getMetadata('tsgraphql:args', target) || [];
		const paramtypes = Reflect.getMetadata('design:paramtypes', target, methodName);
		const isAlreadySet = !!_.find(methodParameters, { methodName, index });
		if (isAlreadySet) return;

		methodParameters.unshift({
			target,
			methodName,
			index,
			name,
			opts,
			handler: target[methodName],
			/*
				The method: Reflect.getMetadata('design:paramtypes', target, methodName);
				doesn't seem to be working in the test environment, so the paramtypes array is always undefined
				TODO: find a better solution
			 */
			type: paramtypes && paramtypes[index]
		});
		Reflect.defineMetadata('tsgraphql:args', methodParameters, target);
	};
}

export interface IResolverDecoratorArgs {
	excludedMethods?: string[];
	resourceSchema?: Function;
}

/**
 * Decorator that annotate a controller.
 * It allows setting the basepath, resourceSchema, etc
 * @param args
 */
export function resolver(args?: IResolverDecoratorArgs): Function {
	return function(target: Object) {
		// define new metadata props
		Reflect.defineMetadata('tsgraphql:resolver', args, target);
	};
}
