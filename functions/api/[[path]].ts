import { app } from '../../server/app';
import type { Env } from '../../server/common';

export const onRequest: PagesFunction<Env> = context => app.fetch(context.request, context.env);
