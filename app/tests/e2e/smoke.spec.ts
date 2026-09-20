import { expect, test, type Page } from '@playwright/test'

/**
 * One end-to-end smoke flow (HANDOFF §7 Phase 5C): new game → draft a round with a trade → sim 4 weeks
 * → reload → state persists → start over from Settings. Selectors are by role and visible text so this survives copy tweaks in
 * app/src/screens; it does not assert on CSS classes or DOM shape.
 */

const NAV = (page: Page) => page.getByRole('navigation', { name: 'Main' }).first()
const HEADER = (page: Page) => page.getByRole('banner')

async function goTo(page: Page, label: string): Promise<void> {
  await NAV(page).getByRole('button', { name: label }).click()
}

/** Click the Dashboard's phase-advance button by its exact label (docs/HANDOFF.md §6.7 phase order). */
async function clickAdvance(page: Page, label: string): Promise<void> {
  await goTo(page, 'Dashboard')
  const button = page.getByRole('button', { name: label, exact: true })
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await button.click()
}

function rosterCount(caption: string | null): number {
  const match = caption?.match(/(\d+) players/)
  return match ? Number(match[1]) : 0
}

/** PRESEASON requires a 53-man roster (HANDOFF §8); cut the lowest-rated players (Roster sorts by Ovr desc). */
async function cutdownToRosterLimit(page: Page): Promise<void> {
  await goTo(page, 'Roster')
  const caption = page.getByText(/roster · \d+ players/).first()
  for (let i = 0; i < 40; i++) {
    const count = rosterCount(await caption.textContent())
    if (count <= 53) return
    await page
      .getByRole('button', { name: /^Release /, exact: false })
      .last()
      .click()
    await page.waitForTimeout(50)
  }
}

/** PRESEASON also requires payroll under the cap; shed the priciest contracts until the alert clears. */
async function fixCapForPreseason(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await goTo(page, 'Dashboard')
    const overCap = await page
      .getByText(/Over the cap by/)
      .isVisible()
      .catch(() => false)
    if (!overCap) return
    await goTo(page, 'Roster')
    await page.getByRole('button', { name: 'APY', exact: true }).click()
    await page
      .getByRole('button', { name: /^Release /, exact: false })
      .first()
      .click()
    await page.waitForTimeout(50)
  }
}

test('new game -> draft round with a trade -> sim 4 weeks -> reload persists', async ({ page }) => {
  await test.step('new game', async () => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Pick your start year' })).toBeVisible()
    await page.getByRole('button', { name: '2012', exact: true }).click()
    await page.getByRole('button', { name: 'Indianapolis Colts' }).click()
    await page.getByRole('button', { name: 'Start' }).click()
    await expect(HEADER(page)).toContainText('2012', { timeout: 15_000 })
  })

  let rosterCaption = ''

  await test.step('sim the first season and reach the draft', async () => {
    // Newly started games begin in PRESEASON with that year's draft already on the roster (HANDOFF §6.7);
    // the next draft (year + 1) comes after this season and its offseason.
    await clickAdvance(page, 'Start the season')
    await expect(page.getByRole('button', { name: 'Sim week' })).toBeVisible({ timeout: 15_000 })

    await goTo(page, 'Schedule')
    await page.getByRole('button', { name: 'Sim season' }).click()
    await expect(HEADER(page)).toContainText('Offseason resign', { timeout: 30_000 })

    await clickAdvance(page, 'Close re-signing and go to the draft')
    await expect(HEADER(page)).toContainText('Draft', { timeout: 15_000 })
  })

  await test.step('draft round one: a pick and a trade', async () => {
    await goTo(page, 'Draft')
    const startButton = page.getByRole('button', { name: 'Start draft' })
    if (await startButton.isVisible()) await startButton.click()

    const onClockHeading = page.getByRole('main').getByText('ON THE CLOCK')
    for (let i = 0; i < 32 && !(await onClockHeading.isVisible()); i++) {
      await page.getByRole('button', { name: 'Sim to my pick' }).click()
      await page.waitForTimeout(100)
    }
    await expect(onClockHeading).toBeVisible({ timeout: 15_000 })

    await page.screenshot({ path: '../docs/screenshots/draft-room.png' })

    const board = page.getByRole('table', { name: /Available prospects/ })
    await board.getByRole('row').nth(1).click()
    await page.getByRole('button', { name: 'Make pick' }).click()
    await expect(page.getByText(/Pick \d+ \(IND\)/)).toBeVisible({ timeout: 15_000 })
  })

  await test.step('propose a trade in the Trade Center', async () => {
    await goTo(page, 'Trades')
    const yourOffer = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Your offer' }) })
    const theirSide = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Their side' }) })
    await yourOffer.getByRole('checkbox').first().check()
    await theirSide.getByRole('checkbox').first().check()

    await page.screenshot({ path: '../docs/screenshots/trade-center.png' })

    await page.getByRole('button', { name: 'Offer trade' }).click()
    // Either outcome proves the acceptance evaluation ran; the trade only needs to be evaluated, not accepted.
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /Trade accepted|Trade fell through|They passed on that trade/ }),
    ).toBeVisible({
      timeout: 15_000,
    })
  })

  await test.step('finish the draft and start the new season', async () => {
    await goTo(page, 'Draft')
    const finishButton = page.getByRole('button', { name: 'Finish draft' })
    if (await finishButton.isEnabled()) await finishButton.click()

    await clickAdvance(page, 'Leave the draft')
    await clickAdvance(page, 'Close UDFA signings')
    await clickAdvance(page, 'Close free agency')
    await clickAdvance(page, 'Break camp')
    await cutdownToRosterLimit(page)
    await fixCapForPreseason(page)
    await clickAdvance(page, 'Start the season')
    await expect(page.getByRole('button', { name: 'Sim week' })).toBeVisible({ timeout: 15_000 })
  })

  let headerBefore = ''
  await test.step('sim 4 weeks', async () => {
    await goTo(page, 'Dashboard')
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Sim week' }).click()
      await expect(page.getByRole('button', { name: 'Sim week' })).toBeEnabled({ timeout: 15_000 })
    }
    // Sim week advances to the following week's matchup; four sims land on "week 5" showing games 1-4 played.
    await expect(HEADER(page)).toContainText('week 5', { timeout: 15_000 })
    headerBefore = (await HEADER(page).textContent()) ?? ''

    await goTo(page, 'Roster')
    const caption = await page
      .getByText(/roster · \d+ players/)
      .first()
      .textContent()
    rosterCaption = caption ?? ''
    expect(rosterCaption).not.toBe('')
  })

  await test.step('save (autosave) and reload persists state', async () => {
    // The store autosaves at every phase transition, every 4th week, and 1s after any change (§6.9).
    await page.waitForTimeout(1_500)

    await page.reload()
    // The new-game screen may offer to resume the autosave ("Continue as ...") instead of restoring
    // straight away; accept that prompt if present.
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true })
    if (await continueButton.isVisible({ timeout: 5_000 }).catch(() => false))
      await continueButton.click()
    await expect(HEADER(page)).toContainText('week 5', { timeout: 15_000 })
    const headerAfter = await HEADER(page).textContent()
    expect(headerAfter).toBe(headerBefore)

    await goTo(page, 'Roster')
    await expect(page.getByText(/roster · \d+ players/).first()).toHaveText(rosterCaption)
  })

  await test.step('start over from Settings returns to New Game with Continue on offer', async () => {
    await goTo(page, 'Settings')
    await page.getByRole('button', { name: 'Start over' }).click()
    await page
      .getByRole('dialog', { name: 'Start over?' })
      .getByRole('button', { name: 'Start over' })
      .click()
    await expect(page.getByRole('heading', { name: 'Pick your start year' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
  })
})
