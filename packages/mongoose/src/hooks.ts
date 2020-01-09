import { ElementType } from '@davinci/reflector';
import { Document, Mongoose, Schema } from 'mongoose';

type Stage = 'pre' | 'post';

export const READ_HOOKS = [
	'countDocuments',
	'find',
	'findOne',
	'findOneAndUpdate',
	'update',
	'updateMany',
	'updateOne'
] as const;

const WRITE_HOOKS = ['findOneAndUpdate', 'save', 'update', 'updateMany', 'updateOne'] as const;

const DELETE_HOOKS = ['deleteMany', 'deleteOne', 'remove', 'findOneAndDelete', 'findOneAndRemove'] as const;

type Hook = ElementType<typeof READ_HOOKS> | ElementType<typeof WRITE_HOOKS> | ElementType<typeof DELETE_HOOKS>;

export interface PreArgs {
	query: Mongoose['Query'];
	hookName: Hook;
	context: unknown;
}
export interface AfterArgs {
	query: Mongoose['Query'];
	hookName: Hook;
	context: unknown;
	result;
}

export interface AfterRawResultArgs {
	query: Mongoose['Query'];
	hookName: Hook;
	context: unknown;
	rawResult: unknown;
}

export interface DocumentPreArgs {
	hookName: Hook;
	context: unknown;
	doc: Document;
}
export interface DocumentPostArgs {
	result: Document;
	hookName: Hook;
	context: unknown;
	doc: Document;
}

/**
 * It maps and generates the hook handler arguments
 * based on the type of the hook
 * @param stage
 * @param hookName
 * @param isReadHook
 * @param isWriteHook
 * @param isDeleteHook
 * @param thisObj
 * @param result
 * @param rest
 * @param context
 */
const createHandlerArgs = (
	stage: Stage,
	hookName: Hook,
	{
		isReadHook,
		isWriteHook,
		isDeleteHook,
		thisObj,
		result,
		rest,
		context
	}: {
		isReadHook: boolean;
		isWriteHook: boolean;
		isDeleteHook: boolean;
		thisObj: Document | Mongoose['Query'];
		result?: unknown;
		rest?: unknown[];
		context?: unknown;
	}
): PreArgs | AfterArgs | AfterRawResultArgs | DocumentPreArgs | DocumentPostArgs | undefined => {
	const operation = (isReadHook && 'read') || (isWriteHook && 'write') || (isDeleteHook && 'delete');
	// createPreArgs creates the arguments for `before(Read|Write|Delete)` hooks
	const createPreArgs = (): PreArgs => ({ query: thisObj as Mongoose['Query'], hookName, context });

	// createAfterArgs creates the arguments for `after(Read|Write|Delete)` hooks
	const createAfterArgs = (): AfterArgs => ({ query: thisObj as Mongoose['Query'], hookName, context, result });

	// createAfterRawResultArgs creates the arguments for `after(Read|Write|Delete)` hooks triggered by atomic operations
	const createAfterRawResultArgs = (): AfterRawResultArgs => ({
		query: thisObj as Mongoose['Query'],
		hookName,
		context,
		rawResult: result
	});

	// createDocumentPreArgs creates the arguments for `before(Read|Write|Delete)` hooks triggered by
	// document middlewares: https://mongoosejs.com/docs/middleware.html
	const createDocumentPreArgs = (): DocumentPreArgs => ({ hookName, context, doc: thisObj as Document });

	// createDocumentPostArgs creates the arguments for `after(Read|Write|Delete)` hooks triggered by
	// document middlewares: https://mongoosejs.com/docs/middleware.html
	const createDocumentPostArgs = (): DocumentPostArgs => ({
		result: thisObj as Document,
		hookName,
		context,
		doc: rest[1] as Document
	});

	const argsSwitch = {
		countDocuments: {
			pre: {
				read: createPreArgs
			},
			post: {
				read: () => ({ query: thisObj, hookName, context, count: result })
			}
		},
		find: {
			pre: {
				read: createPreArgs
			},
			post: {
				read: createAfterArgs
			}
		},
		findOne: {
			pre: {
				read: createPreArgs
			},
			post: {
				read: createAfterArgs
			}
		},
		findOneAndUpdate: {
			pre: {
				read: createPreArgs,
				write: createPreArgs
			},
			post: {
				read: createAfterArgs,
				write: createAfterArgs
			}
		},
		update: {
			pre: {
				read: createPreArgs,
				write: createPreArgs
			},
			post: {
				write: createAfterRawResultArgs
			}
		},
		updateMany: {
			pre: {
				read: createPreArgs,
				write: createPreArgs
			},
			post: {
				write: createAfterRawResultArgs
			}
		},
		updateOne: {
			pre: {
				read: createPreArgs,
				write: createPreArgs
			},
			post: {
				write: createAfterRawResultArgs
			}
		},
		findOneAndDelete: {
			pre: {
				delete: createPreArgs
			},
			post: {
				delete: createAfterArgs
			}
		},
		findOneAndRemove: {
			pre: {
				delete: createPreArgs
			},
			post: {
				delete: createAfterArgs
			}
		},
		deleteOne: {
			pre: {
				delete: createPreArgs
			},
			post: {
				delete: createAfterRawResultArgs
			}
		},
		deleteMany: {
			pre: {
				delete: createPreArgs
			},
			post: {
				delete: createAfterRawResultArgs
			}
		},
		remove: {
			pre: {
				delete: createDocumentPreArgs
			},
			post: {
				delete: createDocumentPostArgs
			}
		},
		save: {
			pre: {
				write: createDocumentPreArgs
			},
			post: {
				write: createDocumentPostArgs
			}
		}
	};

	return argsSwitch?.[hookName]?.[stage]?.[operation]?.();
};

/**
 * Factory function that generates (before|after)(Read|Write|Delete) utilities
 * @param hooksList
 * @param stage
 */
const createRegisterHooks = (hooksList, stage: Stage) => (mongooseSchema, handler): void => {
	const isReadHook = hooksList === READ_HOOKS;
	const isWriteHook = hooksList === WRITE_HOOKS;
	const isDeleteHook = hooksList === DELETE_HOOKS;

	const hasContextInOptions = (hook: Hook): boolean =>
		isReadHook || isDeleteHook || ['findOneAndUpdate', 'update', 'updateMany', 'updateOne'].includes(hook);
	const hasContextInSaveOptions = (hook: Hook): boolean =>
		isWriteHook && !['findOneAndUpdate', 'update', 'updateMany', 'updateOne'].includes(hook);

	hooksList.forEach(hook =>
		mongooseSchema[stage](hook, async function hookHandlerWrapper(result, ...rest) {
			let context;
			if (hasContextInOptions(hook)) {
				context = this.options?.context;
				if (this.options?.skipHooks) {
					return;
				}
			}
			if (hasContextInSaveOptions(hook)) {
				// eslint-disable-next-line no-underscore-dangle
				context = this.$__.saveOptions?.context;
				// eslint-disable-next-line no-underscore-dangle
				if (this.$__.saveOptions?.skipHooks) {
					return;
				}
			}

			const args = createHandlerArgs(stage, hook, {
				isReadHook,
				isWriteHook,
				isDeleteHook,
				thisObj: this,
				result,
				context,
				rest
			});

			if (args) {
				await handler(args);
			}
		})
	);
};

export type Handler = {
	beforeRead: (args: PreArgs) => unknown | Promise<unknown>;
	afterRead: (args: AfterArgs) => unknown | Promise<unknown>;

	beforeWrite: (args: PreArgs & DocumentPreArgs) => unknown | Promise<unknown>;
	afterWrite: (args: AfterArgs & DocumentPostArgs & AfterRawResultArgs) => unknown | Promise<unknown>;

	beforeDelete: (args: PreArgs & DocumentPreArgs) => unknown | Promise<unknown>;
	afterDelete: (args: AfterArgs & DocumentPostArgs & AfterRawResultArgs) => unknown | Promise<unknown>;
};

export function beforeRead(schema: Schema, handler: Handler['beforeRead']): void {
	return createRegisterHooks(READ_HOOKS, 'pre')(schema, handler);
}

export function afterRead(schema: Schema, handler: Handler['afterRead']): void {
	return createRegisterHooks(READ_HOOKS, 'post')(schema, handler);
}

export function beforeWrite(schema: Schema, handler: Handler['beforeWrite']): void {
	return createRegisterHooks(WRITE_HOOKS, 'pre')(schema, handler);
}

export function afterWrite(schema: Schema, handler: Handler['afterWrite']): void {
	return createRegisterHooks(WRITE_HOOKS, 'post')(schema, handler);
}

export function beforeDelete(schema: Schema, handler: Handler['beforeDelete']): void {
	return createRegisterHooks(DELETE_HOOKS, 'pre')(schema, handler);
}

export function afterDelete(schema: Schema, handler: Handler['afterDelete']): void {
	return createRegisterHooks(DELETE_HOOKS, 'post')(schema, handler);
}
