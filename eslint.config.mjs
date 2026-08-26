// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    name: 'schedra/pure-layers',
    files: [
      'server/utils/**/*.ts',
      'server/domain/**/*.ts',
      'shared/**/*.ts'
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'drizzle-orm',
            message: 'Pure layers cannot depend on the database. Put persistence in server/repositories.'
          },
          {
            name: 'postgres',
            message: 'Pure layers cannot depend on the database. Put persistence in server/repositories.'
          }
        ],
        patterns: [
          {
            group: ['**/database', '**/database/**', '**/repositories', '**/repositories/**'],
            message: 'Pure layers cannot depend on persistence. Put queries in server/repositories.'
          }
        ]
      }]
    }
  }
)
