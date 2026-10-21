import { NextResponse } from 'next/server';
import { designBrief } from '@/lib/design';

export const maxDuration = 60;

// REST twin of the design_brief MCP tool, for agents that cannot speak MCP
// (ChatGPT Actions, Grok, scripts). Same Bearer STASH_TOKEN as the MCP route.
// GET returns an OpenAPI description to paste into a ChatGPT Action.

const origin = (req) => new URL(req.url).origin;

function authorised(req) {
  const t = process.env.STASH_TOKEN;
  if (!t) return false;
  const h = req.headers.get('authorization') || '';
  return h === 'Bearer ' + t || new URL(req.url).searchParams.get('token') === t;
}

export async function GET(req) {
  return NextResponse.json({
    openapi: '3.1.0',
    info: { title: 'Stash design brief', version: '1.0.0', description: 'Pick the best premium components from the user\'s library for a website, page or section.' },
    servers: [{ url: origin(req) }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearer: [] }],
    paths: {
      '/api/design-brief': {
        post: {
          operationId: 'designBrief',
          summary: 'Call before designing or building any website, hero or UI section. Returns the best components for it, a style guide and anti-generic rules.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object', required: ['brief'],
              properties: {
                brief: { type: 'string', description: 'What is being built, for whom, and the feeling wanted.' },
                sections: { type: 'array', items: { type: 'string' } },
                style: { type: 'string' },
                stack: { type: 'array', items: { type: 'string' } },
                premium: { type: 'number', minimum: 0, maximum: 1 },
              },
            } } },
          },
          responses: { 200: { description: 'Design brief', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
    },
  });
}

export async function POST(req) {
  if (!authorised(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Send JSON: {"brief": "..."}' }, { status: 400 }); }
  try {
    return NextResponse.json(await designBrief(body || {}));
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 400 });
  }
}
