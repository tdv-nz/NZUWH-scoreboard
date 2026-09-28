import worker from '../../worker/index';
import type { Env } from '../../worker/types';

type PagesContext = { request: Request; env: Pick<Env, 'DB'> };

export function onRequest({ request, env }: PagesContext): Promise<Response> {
  return worker.fetch(request, {
    DB: env.DB,
    ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) },
  });
}
