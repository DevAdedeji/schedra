export default defineAppConfig({
  ui: {
    colors: {
      primary: 'vermillion',
      neutral: 'stone'
    },
    button: {
      slots: {
        base: 'justify-center text-center'
      },
      defaultVariants: {
        size: 'lg'
      }
    },
    input: {
      slots: {
        base: 'max-sm:min-h-12'
      }
    },
    select: {
      slots: {
        base: 'max-sm:min-h-12'
      }
    },
    selectMenu: {
      slots: {
        base: 'max-sm:min-h-12'
      }
    }
  }
})
