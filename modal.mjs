import puppeteer from 'puppeteer'
const OUT = '/home/user/shots'
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

const seen = () => page.evaluate(() => localStorage.getItem('mt-news-seen'))
const modalVisible = () => page.evaluate(() => !!document.querySelector('.news-modal'))

// 1) Первый заход: окошка быть не должно, версия помечается прочитанной
await page.goto('http://127.0.0.1:4179/', { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 1500))
console.log('первый заход → окошко:', await modalVisible(), '| запомнено:', await seen())
await page.screenshot({ path: `${OUT}/0.102-первый-заход-без-окошка.png` })

// 2) Имитируем ОБНОВЛЕНИЕ: на устройстве запомнена прошлая версия
await page.evaluate(() => { localStorage.setItem('mt-news-seen', '0.101'); localStorage.setItem('mt-theme', 'dark') })
await page.reload({ waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 1600))
console.log('после обновления → окошко:', await modalVisible())
await page.screenshot({ path: `${OUT}/0.102-окошко-что-нового.png` })

// 3) Крестик закрывает и помечает версию
await page.click('.news-modal-x')
await new Promise((r) => setTimeout(r, 400))
console.log('после крестика → окошко:', await modalVisible(), '| запомнено:', await seen())
await page.screenshot({ path: `${OUT}/0.102-после-крестика.png` })

// 4) Перезагрузка: не возвращается
await page.reload({ waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 1500))
console.log('после перезагрузки → окошко:', await modalVisible())

// 5) Раздел «Что нового» — только текущая версия
await page.evaluate(() => { localStorage.setItem('mt-theme', 'light'); localStorage.setItem('mt-view', JSON.stringify('whatsnew')) })
await page.reload({ waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 1600))
const cards = await page.evaluate(() => [...document.querySelectorAll('.news-card')].map((c) => (c.querySelector('.news-ver') || {}).textContent))
console.log('карточек в разделе:', cards.length, '| версии:', JSON.stringify(cards))
await page.screenshot({ path: `${OUT}/0.102-раздел-только-текущая.png` })
await browser.close()
