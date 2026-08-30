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
        base: 'max-sm:min-h-10'
      }
    },
    select: {
      slots: {
        base: 'max-sm:min-h-10'
      }
    },
    selectMenu: {
      slots: {
        base: 'max-sm:min-h-10'
      }
    },
    modal: {
      slots: {
        content: 'max-sm:w-[95vw]! max-sm:max-w-[95vw]!',
        header: 'items-start',
        wrapper: 'min-w-0 flex-1 pe-10',
        title: 'max-sm:text-[17px] max-sm:leading-6',
        description: 'max-sm:mt-1.5 max-sm:text-[13px] max-sm:leading-5',
        close: 'max-sm:top-3 max-sm:end-3'
      }
    }
  }
})
