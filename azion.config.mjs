import { defineConfig } from 'azion/config'

const APP = 'status-page'
// BUCKET and the prefix must match bucket and prefix in azion/azion.json. The CLI rewrites the prefix literals on every deploy (rotate-prefix), so keep them inline.
const BUCKET = 'status-page'
const CONNECTOR = `${APP}-site`
// Matches the function already recorded in azion/azion.json, so deploys update it instead of creating another one.
const FUNCTION = APP

export default defineConfig({
  build: { entry: './src/functions/main.js', bundler: 'esbuild' },
  storage: [
    {
      name: BUCKET,
      prefix: '20261026105238',
      dir: './public',
      workloadsAccess: 'read_only'
    }
  ],
  connectors: [
    {
      name: CONNECTOR,
      active: true,
      type: 'storage',
      attributes: { bucket: BUCKET, prefix: '20261026105238' }
    }
  ],
  functions: [{ name: FUNCTION, path: './functions/main.js' }],
  applications: [
    {
      name: APP,
      functionsEnabled: true,
      cache: [
        {
          name: APP,
          browser: { maxAgeSeconds: 300 },
          edge: { maxAgeSeconds: 3600 }
        }
      ],
      rules: {
        request: [
          {
            name: 'API',
            description: 'Run the function for /api/*, never from cache',
            active: true,
            criteria: [
              [
                {
                  variable: '${uri}',
                  conditional: 'if',
                  operator: 'starts_with',
                  argument: '/api/'
                }
              ]
            ],
            behaviors: [
              { type: 'bypass_cache' },
              { type: 'forward_cookies' },
              { type: 'run_function', attributes: { value: FUNCTION } }
            ]
          },
          {
            name: 'Static assets',
            description: 'Deliver files from storage',
            active: true,
            criteria: [
              [
                {
                  variable: '${uri}',
                  conditional: 'if',
                  operator: 'matches',
                  argument:
                    '\\.(html|css|js|mjs|svg|png|jpg|jpeg|webp|ico|woff2?|txt|json|md|webmanifest)$'
                }
              ]
            ],
            behaviors: [
              { type: 'set_connector', attributes: { value: CONNECTOR } },
              { type: 'set_cache_policy', attributes: { value: APP } },
              { type: 'deliver' }
            ]
          },
          {
            name: 'Page routes',
            description: 'Rewrite every other path to index.html',
            active: true,
            criteria: [
              [
                {
                  variable: '${uri}',
                  conditional: 'if',
                  operator: 'does_not_match',
                  argument: '^/api/'
                },
                {
                  variable: '${uri}',
                  conditional: 'and',
                  operator: 'does_not_match',
                  argument: '\\.[a-zA-Z0-9]+$'
                }
              ]
            ],
            behaviors: [
              { type: 'set_connector', attributes: { value: CONNECTOR } },
              { type: 'set_cache_policy', attributes: { value: APP } },
              { type: 'rewrite_request', attributes: { value: '/index.html' } }
            ]
          }
        ]
      },
      functionsInstances: [{ name: FUNCTION, ref: FUNCTION }]
    }
  ],
  workloads: [
    {
      name: APP,
      active: true,
      infrastructure: 1,
      // domains: ['status.azion.app'],
      deployments: [
        {
          name: `${APP}-production`,
          current: true,
          active: true,
          strategy: { type: 'default', attributes: { application: APP } }
        }
      ]
    }
  ]
})
