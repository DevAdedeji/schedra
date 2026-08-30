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
      variants: {
        size: {
          lg: {
            base: 'min-h-10'
          }
        }
      },
      defaultVariants: {
        size: 'lg'
      }
    },
    input: {
      variants: {
        size: {
          lg: {
            base: 'min-h-10'
          }
        }
      },
      defaultVariants: {
        size: 'lg'
      }
    },
    select: {
      variants: {
        size: {
          lg: {
            base: 'min-h-10'
          }
        }
      },
      defaultVariants: {
        size: 'lg'
      }
    },
    selectMenu: {
      variants: {
        size: {
          lg: {
            base: 'min-h-10'
          }
        }
      },
      defaultVariants: {
        size: 'lg'
      }
    },
    modal: {
      slots: {
        content: 'max-sm:mx-auto max-sm:w-[calc(100vw-2rem)]! max-sm:max-w-[calc(100vw-2rem)]!',
        header: 'w-full shrink-0 items-start',
        wrapper: 'min-w-0 flex-1 pe-10',
        body: 'min-h-0',
        footer: 'shrink-0',
        title: 'max-sm:text-[17px] max-sm:leading-6',
        description: 'break-words whitespace-normal max-sm:mt-1.5 max-sm:text-[13px] max-sm:leading-5',
        close: 'max-sm:top-3 max-sm:end-3'
      }
    }
  }
})
