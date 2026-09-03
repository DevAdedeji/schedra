import { expect, test } from '@playwright/test'

test('keeps email sign-up actionable and explains validation failures', async ({ page }) => {
  await page.goto('/signup')
  await expect(page.getByTestId('signup-form')).toHaveAttribute('data-ready', 'true')

  const submit = page.getByRole('button', { name: 'Create my link' })
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(page.getByText('At least 2 characters')).toBeVisible()
  await expect(page.getByText('At least 10 characters')).toBeVisible()
})

test('retries the booking-link check instead of trapping the user behind a disabled button', async ({ page }) => {
  await page.route('**/api/username-available**', route => route.abort())
  await page.goto('/signup')
  await expect(page.getByTestId('signup-form')).toHaveAttribute('data-ready', 'true')

  await page.getByLabel('Your name').fill('Zoom Reviewer')
  await page.getByLabel('Your booking link').fill('zoom-reviewer')
  await page.getByLabel('Email').fill('zoom-reviewer@schedra.test')
  await page.locator('input[name="password"]').fill('a-production-grade-passphrase')

  const submit = page.getByRole('button', { name: 'Create my link' })
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(page.getByRole('alert')).toContainText('We could not check your booking link')
  await expect(submit).toBeEnabled()
})
