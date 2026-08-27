interface FeedbackOptions {
  title: string
  description?: string
}

export function useFeedback() {
  const toast = useToast()

  function success({ title, description }: FeedbackOptions) {
    toast.add({
      title,
      description,
      color: 'success',
      icon: 'i-lucide-circle-check',
      duration: 3500
    })
  }

  function error({ title, description }: FeedbackOptions) {
    toast.add({
      title,
      description,
      color: 'error',
      icon: 'i-lucide-circle-alert',
      duration: 5000
    })
  }

  function warning({ title, description }: FeedbackOptions) {
    toast.add({
      title,
      description,
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
      duration: 5000
    })
  }

  return { success, warning, error }
}
