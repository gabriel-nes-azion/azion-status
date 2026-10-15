/**
 * This file was automatically generated based on your preset configuration.
 *
 * For better type checking and IntelliSense:
 * 1. Install azion config as dev dependency:
 *    npm install -D @aziontech/config
 *
 * 2. Use defineConfig:
 *    import { defineConfig } from '@aziontech/config'
 *
 * 3. Replace the configuration with defineConfig:
 *    export default defineConfig({
 *      // Your configuration here
 *    })
 *
 * For more configuration options, visit:
 * https://github.com/aziontech/lib/tree/main/packages/config
 */

export default {
  build: {
    preset: 'javascript',
    polyfills: true
  },
  functions: [
    {
      name: 'status-page',
      path: './functions/index.js'
    }
  ],
  applications: [
    {
      name: 'status-page',
      rules: {
        request: [
          {
            name: 'Execute Function',
            description: 'Execute function for all requests',
            active: true,
            criteria: [
              [
                {
                  variable: '${uri}',
                  conditional: 'if',
                  operator: 'matches',
                  argument: '^/'
                }
              ]
            ],
            behaviors: [
              {
                type: 'run_function',
                attributes: {
                  value: 'status-page'
                }
              }
            ]
          }
        ]
      },
      functionsInstances: [
        {
          name: 'status-page',
          ref: 'status-page'
        }
      ]
    }
  ],
  workloads: [
    {
      name: 'status-page',
      active: true,
      infrastructure: 1,
      deployments: [
        {
          name: 'status-page',
          current: true,
          active: true,
          strategy: {
            type: 'default',
            attributes: {
              application: 'status-page'
            }
          }
        }
      ]
    }
  ]
}
