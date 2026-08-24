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

  return { success }
}
