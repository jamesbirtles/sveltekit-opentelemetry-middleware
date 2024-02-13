import type { Handle } from '@sveltejs/kit';
import { trace, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import { flatten } from 'flat';


type TraceOptions = {
    captureRequestBody?: boolean;
    captureResponseBody?: boolean;
    requestIdHeader?: string;
}

const possibleRequestIdHeaders = [
    "x-request-id",
    "x-vercel-id"
];


/**
 * 
 * @param fn {Handle} The handle hook runs every time the SvelteKit server receives a request and determines the response. It receives an event object representing the request and a function called resolve, which renders the route and generates a Response. This allows you to modify response headers or bodies, or bypass SvelteKit entirely (for implementing routes programmatically, for example).
 * @param opts.captureRequestBody {boolean} Capture the request body in the span.
 * @param opts.captureResponseBody {boolean} Capture the response body in the span.
 * @param opts.requestIdHeader {string} The header to look for the request id in. By default it will check x-request-id and x-vercel-id.
 * @returns {Handle}
 */
export function withOpenTelemetry(fn: Handle, opts?: TraceOptions): Handle {
    opts = opts || {};
    const tracer = trace.getTracer('@baselime/sveltekit-opentelemetry-middleware');
    return async function (args) {
        const name = `${args.event.request.method} ${args.event.route.id}`;
        let requestId: string | undefined = undefined;

        if(opts.requestIdHeader) {
            possibleRequestIdHeaders.push(opts.requestIdHeader.toLowerCase());
        }
        for(const [key, value] of args.event.request.headers.entries()) {
            if(possibleRequestIdHeaders.includes(key.toLowerCase())) {
                requestId = value;
                break;
            }
        }

        return tracer.startActiveSpan(name, {
            // SpanKind.SERVER -> 1
            kind: 1,
            attributes: flatten({
                requestId,
                http: {
                    headers: args.event.request.headers,
                    method: args.event.request.method,
                    url: args.event.request.url,
                    ...opts.captureRequestBody && {
                        request: {
                            // todo format based on headers
                            body: args.event.request.body,
                        }
                    },
                   
                },
                svelte: {
                    route: args.event.route,
                    isDataRequest: args.event.isDataRequest,
                    isSubRequest: args.event.isSubRequest,
                    params: args.event.params,
                    platform: args.event.platform
                }
            })
        }, async (span) => {

            const res = await fn(args);

            span.setAttributes(flatten({
                http: {
                    status: res.status,
                    ...opts.captureResponseBody && {
                        response: {
                            body: res.body
                        }
                    }
                }
            }));
            
            span.end();

            return res;
        });
    };
}