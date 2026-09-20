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

/**
 * PRESEASON requires 53 players under the cap (HANDOFF §8). The Roster screen's Cutdown panel lists the
 * engine's suggested cuts and releases them in one action; a roster that is already legal shows no panel.
 */
async function cutdownForPreseason(page: Page): Promise<void> {
  await goTo(page, 'Roster')
  const releaseAll = page.getByRole('button', { name: /^Release \d+ players?$/ })
  if (await releaseAll.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await page.screenshot({ path: '../docs/screenshots/cutdown.png' })
    await releaseAll.click()
    await expect(releaseAll).toBeHidden({ timeout: 15_000 })
  }
}

test('new game -> opening draft with a trade -> season start -> sim 4 weeks -> reload persists', async ({
  page,
}) => {
  await test.step('new game opens in the offseason before the start year', async () => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Pick your start year' })).toBeVisible()
    await page.getByRole('button', { name: '2012', exact: true }).click()
    await page.getByRole('button', { name: 'Indianapolis Colts' }).click()
    await page.getByRole('button', { name: 'Start' }).click()
    // A 2012 start opens at the 2012 draft (docs/superpowers/specs/2026-09-20-opening-offseason-design.md).
    await expect(HEADER(page)).toContainText('2012 offseason', { timeout: 15_000 })
    await expect(HEADER(page)).toContainText('Draft')
  })

  let rosterCaption = ''

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

  await test.step('finish the draft, run the offseason and start the season', async () => {
    await goTo(page, 'Draft')
    const finishButton = page.getByRole('button', { name: 'Finish draft' })
    if (await finishButton.isEnabled()) await finishButton.click()

    await clickAdvance(page, 'Leave the draft')
    await clickAdvance(page, 'Close UDFA signings')
    await clickAdvance(page, 'Close free agency')
    await clickAdvance(page, 'Break camp')
    await expect(HEADER(page)).toContainText('2012 · Preseason', { timeout: 15_000 })
    await cutdownForPreseason(page)
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

  await test.step('export save downloads a JSON file from Settings', async () => {
    await goTo(page, 'Settings')
    const dl = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export save' }).click()
    expect((await dl).suggestedFilename()).toMatch(/^gridiron-gm-.*\.json$/)
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
