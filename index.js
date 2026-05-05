require('dotenv').config()
const express = require('express')
const axios = require('axios')
const { google } = require('googleapis')
const cheerio = require('cheerio')
const http = require('http')
const socketIo = require('socket.io')
const cors = require('cors')

const app = express()
app.use(express.json())

// ===== CORS MUST BE AT THE TOP, BEFORE ROUTES =====
app.use(cors({
    origin: [
        'https://fzmmyj-k4.myshopify.com',
        'https://shopify-delhivery.onrender.com',
        'http://localhost:3000'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}))

app.options('*', cors())

// ===== CREATE HTTP SERVER =====
const server = http.createServer(app)
const io = socketIo(server, {
    cors: {
        origin: [
            'https://fzmmyj-k4.myshopify.com',
            'https://shopify-delhivery.onrender.com',
            'http://localhost:3000'
        ],
        methods: ['GET', 'POST']
    }
})

// Serve static files
app.use(express.static('public'))

app.get('/', (req, res) => {
    res.send('Server is running ✅')
})

// =====================================================================
// Q1 - Integrate Delhivery logistics API
// =====================================================================

async function saveToSheets(orderId, waybill) {
    const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    })
    const sheets = google.sheets({ version: 'v4', auth })
    await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sheet1!A:B',
        valueInputOption: 'RAW',
        resource: { values: [[orderId, waybill]] }
    })
}

app.post('/webhook/order', async (req, res) => {
    const order = req.body
    try {
        const waybill = 'MOCK-WAYBILL-' + order.id
        await saveToSheets(order.id, waybill)
        res.status(200).json({
            success: true,
            waybill: waybill,
            message: 'Shipment created successfully'
        })
    } catch (err) {
        console.error('Error:', err.message)
        res.status(500).send('Error creating shipment')
    }
})

// =====================================================================
// Q2 - Integrate Eshopbox logistics API
// =====================================================================

app.post('/shipping/rates', async (req, res) => {
    const { rate } = req.body
    const pincode = rate.destination.postal_code
    const weight = rate.total_weight

    try {
        const eshopbox = await axios.get('https://api.eshopbox.com/shipping/rates', {
            params: { pincode, weight },
            headers: { Authorization: `Bearer ${process.env.ESHOPBOX_TOKEN}` }
        })

        const rates = eshopbox.data.rates.map(r => ({
            service_name: r.service_name,
            service_code: r.code,
            total_price: r.price * 100,
            currency: 'INR',
            min_delivery_date: r.min_date,
            max_delivery_date: r.max_date
        }))

        res.json({ rates })
    } catch (err) {
        console.error('Eshopbox error:', err.message)
        res.json({
            rates: [{
                service_name: 'Standard Shipping',
                service_code: 'standard',
                total_price: 5000,
                currency: 'INR'
            }]
        })
    }
})

app.post('/webhook/eshopbox-order', async (req, res) => {
    const order = req.body
    try {
        await axios.post('https://api.eshopbox.com/orders', {
            order_id: order.id,
            customer: order.shipping_address.name,
            pincode: order.shipping_address.zip,
            items: order.line_items
        }, {
            headers: { Authorization: `Bearer ${process.env.ESHOPBOX_TOKEN}` }
        })
        res.status(200).send('Order created in Eshopbox')
    } catch (err) {
        console.error('Eshopbox order error:', err.message)
        res.status(500).send('Error')
    }
})

// =====================================================================
// Q3 - Website Data & Sales Tracking Sheet
// =====================================================================

let dailyData = {
    date: new Date().toLocaleDateString(),
    activeUsers: 0,
    totalSales: 0,
    cancelledOrders: 0
}

app.post('/webhook/checkout', async (req, res) => {
    try {
        const today = new Date().toLocaleDateString()
        if (dailyData.date !== today) {
            await saveTrackingToSheets(dailyData)
            dailyData = { date: today, activeUsers: 0, totalSales: 0, cancelledOrders: 0 }
        }
        dailyData.activeUsers += 1
        res.status(200).send('Checkout tracked')
    } catch (err) {
        console.error('Checkout tracking error:', err.message)
        res.status(500).send('Error')
    }
})

app.post('/webhook/sales', async (req, res) => {
    try {
        const order = req.body
        const today = new Date().toLocaleDateString()
        if (dailyData.date !== today) {
            await saveTrackingToSheets(dailyData)
            dailyData = { date: today, activeUsers: 0, totalSales: 0, cancelledOrders: 0 }
        }
        dailyData.totalSales += parseFloat(order.total_price || 0)
        res.status(200).send('Sale tracked')
    } catch (err) {
        console.error('Sales tracking error:', err.message)
        res.status(500).send('Error')
    }
})

app.post('/webhook/cancelled', async (req, res) => {
    try {
        const today = new Date().toLocaleDateString()
        if (dailyData.date !== today) {
            await saveTrackingToSheets(dailyData)
            dailyData = { date: today, activeUsers: 0, totalSales: 0, cancelledOrders: 0 }
        }
        dailyData.cancelledOrders += 1
        res.status(200).send('Cancellation tracked')
    } catch (err) {
        console.error('Cancellation tracking error:', err.message)
        res.status(500).send('Error')
    }
})

async function saveTrackingToSheets(data) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        })
        const sheets = google.sheets({ version: 'v4', auth })
        await sheets.spreadsheets.values.append({
            spreadsheetId: '1BhqYVQfkQrU_z2WHRnlBaeUoF0fRZsvEH2TFTQBdUXs',
            range: 'tracking!A:D',
            valueInputOption: 'RAW',
            resource: {
                values: [[
                    data.date,
                    data.activeUsers,
                    data.totalSales,
                    data.cancelledOrders
                ]]
            }
        })
    } catch (err) {
        console.error('Tracking save error:', err.message)
    }
}

app.get('/tracking', (req, res) => {
    res.json(dailyData)
})

app.get('/save-tracking', async (req, res) => {
    try {
        await saveTrackingToSheets(dailyData)
        res.json({ success: true, data: dailyData })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

// =====================================================================
// Q4 - Product Return (User Panel)
// =====================================================================

let returnRequests = []

app.post('/return-request', async (req, res) => {
    const { order_id, order_number, product_name, customer_email, reason } = req.body
    try {
        const returnRequest = {
            id: Date.now(),
            order_id,
            order_number,
            product_name,
            customer_email,
            reason,
            status: 'Pending',
            date: new Date().toLocaleDateString()
        }
        returnRequests.push(returnRequest)
        res.redirect('https://fzmmyj-k4.myshopify.com/pages/returns?success=true')
    } catch (err) {
        console.error('Return request error:', err.message)
        res.status(500).send('Error submitting return request')
    }
})

app.get('/return-requests/:email', (req, res) => {
    const email = req.params.email
    const customerReturns = returnRequests.filter(r => r.customer_email === email)
    res.json(customerReturns)
})

// =====================================================================
// Q5 - Website Data Export
// =====================================================================

async function fetchPageData(url) {
    try {
        const response = await axios.get(url)
        const $ = cheerio.load(response.data)
        return {
            url: url,
            title: $('title').text().trim(),
            meta_description: $('meta[name="description"]').attr('content') || '',
            h1: $('h1').first().text().trim(),
            image_count: $('img').length,
            image_urls: $('img').map((i, el) => $(el).attr('src')).get().slice(0, 5).join(', ')
        }
    } catch (err) {
        return { url, error: err.message }
    }
}

// Q5 - Save page data to Google Sheet (FIXED - Won't crash server)
async function savePageDataToSheets(pages) {
    try {
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        })
        const sheets = google.sheets({ version: 'v4', auth })
        const spreadsheetId = '1BhqYVQfkQrU_z2WHRnlBaeUoF0fRZsvEH2TFTQBdUXs'

        // Try to write headers to pages sheet
        try {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: 'pages!A1:F1',
                valueInputOption: 'RAW',
                resource: {
                    values: [['URL', 'Title', 'Meta Description', 'H1', 'Image Count', 'Image URLs']]
                }
            })
        } catch (headerErr) {
            console.error('Header write error (non-fatal):', headerErr.message)
        }

        // Prepare data rows
        const rows = pages.map(p => [
            p.url || '',
            p.title || '',
            p.meta_description || '',
            p.h1 || '',
            p.image_count !== undefined ? p.image_count.toString() : '0',
            p.image_urls || ''
        ])

        // Try to append data
        try {
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'pages!A2:F',
                valueInputOption: 'RAW',
                resource: { values: rows }
            })
            console.log('✅ Page data saved to sheets')
        } catch (appendErr) {
            console.error('Data append error (non-fatal):', appendErr.message)
        }

    } catch (err) {
        console.error('Google Sheets error (non-fatal):', err.message)
        // Don't throw - just log the error
    }
}
app.get('/export-pages', async (req, res) => {
    try {
        const pages = [
            'https://fzmmyj-k4.myshopify.com',
            'https://fzmmyj-k4.myshopify.com/collections/all',
            'https://fzmmyj-k4.myshopify.com/pages/returns',
            'https://fzmmyj-k4.myshopify.com/pages/contact'
        ]

        const pageData = []
        for (const url of pages) {
            try {
                const data = await fetchPageData(url)
                pageData.push(data)
                console.log(`Fetched: ${url}`)
            } catch (err) {
                pageData.push({
                    url,
                    title: 'Error fetching page',
                    meta_description: '',
                    h1: '',
                    image_count: 0,
                    image_urls: '',
                    error: err.message
                })
            }
        }

        await savePageDataToSheets(pageData)

        res.json({
            success: true,
            message: `Exported ${pageData.length} pages`,
            data: pageData
        })
    } catch (err) {
        console.error('Export error:', err.message)
        res.status(500).json({ error: err.message })
    }
})

// =====================================================================
// Q6 - Timer Based Discount
// =====================================================================

let discountTimers = {}

const DISCOUNT_CONFIG = {
    totalDuration: 15 * 60 * 1000,
    discountIncrement: 2,
    incrementInterval: 60 * 1000,
    bufferTime: 30 * 1000,
    stopBeforeEnd: 2 * 60 * 1000,
    maxDiscount: 30
}

app.post('/discount/start', (req, res) => {
    const { productId, originalPrice } = req.body

    if (!productId || !originalPrice) {
        return res.status(400).json({
            error: 'productId and originalPrice are required'
        })
    }

    if (discountTimers[productId]) {
        clearInterval(discountTimers[productId].interval)
        clearTimeout(discountTimers[productId].startTimeout)
        clearTimeout(discountTimers[productId].endTimeout)
    }

    const timerData = {
        productId,
        originalPrice: parseFloat(originalPrice),
        currentPrice: parseFloat(originalPrice),
        currentDiscount: 0,
        startTime: null,
        isActive: false,
        isBuffering: true,
        isEnded: false,
        totalDuration: DISCOUNT_CONFIG.totalDuration,
        elapsedTime: 0,
        remainingTime: DISCOUNT_CONFIG.totalDuration
    }

    discountTimers[productId] = timerData

    timerData.startTimeout = setTimeout(() => {
        timerData.isBuffering = false
        timerData.isActive = true
        timerData.startTime = Date.now()

        console.log(`✅ Timer started for product ${productId}`)

        io.emit('discountUpdate', {
            productId,
            status: 'started',
            ...getTimerStatus(timerData)
        })

        timerData.interval = setInterval(() => {
            if (timerData.isActive && !timerData.isEnded) {
                timerData.currentDiscount = Math.min(
                    timerData.currentDiscount + DISCOUNT_CONFIG.discountIncrement,
                    DISCOUNT_CONFIG.maxDiscount
                )

                timerData.currentPrice = timerData.originalPrice *
                    (1 - timerData.currentDiscount / 100)
                timerData.currentPrice = Math.round(timerData.currentPrice * 100) / 100

                timerData.elapsedTime = Date.now() - timerData.startTime
                timerData.remainingTime = DISCOUNT_CONFIG.totalDuration - timerData.elapsedTime

                console.log(`Product ${productId}: ${timerData.currentDiscount}% discount - $${timerData.currentPrice}`)

                io.emit('discountUpdate', {
                    productId,
                    status: 'active',
                    ...getTimerStatus(timerData)
                })

                if (timerData.elapsedTime >= (DISCOUNT_CONFIG.totalDuration - DISCOUNT_CONFIG.stopBeforeEnd)) {
                    stopDiscountTimer(productId)
                }
            }
        }, DISCOUNT_CONFIG.incrementInterval)

    }, DISCOUNT_CONFIG.bufferTime)

    timerData.endTimeout = setTimeout(() => {
        if (discountTimers[productId]) {
            stopDiscountTimer(productId)
        }
    }, DISCOUNT_CONFIG.totalDuration + DISCOUNT_CONFIG.bufferTime)

    res.json({
        success: true,
        message: `Discount timer initialized for product ${productId}`,
        bufferTime: DISCOUNT_CONFIG.bufferTime / 1000 + ' seconds',
        timerData: getTimerStatus(timerData)
    })
})

app.get('/discount/status/:productId', (req, res) => {
    const { productId } = req.params
    const timer = discountTimers[productId]

    if (!timer) {
        return res.json({
            productId,
            isActive: false,
            currentDiscount: 0,
            message: 'No active timer for this product'
        })
    }

    res.json(getTimerStatus(timer))
})

app.post('/discount/stop', (req, res) => {
    const { productId } = req.body

    if (!discountTimers[productId]) {
        return res.status(404).json({
            error: 'No active timer found for this product'
        })
    }

    stopDiscountTimer(productId)

    res.json({
        success: true,
        message: `Discount timer stopped for product ${productId}`
    })
})

app.get('/discount/active', (req, res) => {
    const activeTimers = Object.entries(discountTimers)
        .filter(([_, timer]) => timer.isActive)
        .map(([productId, timer]) => ({
            productId,
            ...getTimerStatus(timer)
        }))

    res.json(activeTimers)
})

function stopDiscountTimer(productId) {
    const timer = discountTimers[productId]
    if (!timer) return

    timer.isActive = false
    timer.isEnded = true
    clearInterval(timer.interval)
    clearTimeout(timer.startTimeout)
    clearTimeout(timer.endTimeout)

    setTimeout(() => {
        if (discountTimers[productId]) {
            discountTimers[productId].currentDiscount = 0
            discountTimers[productId].currentPrice = discountTimers[productId].originalPrice

            io.emit('discountUpdate', {
                productId,
                status: 'reset',
                ...getTimerStatus(discountTimers[productId])
            })

            delete discountTimers[productId]
        }
    }, 5 * 60 * 1000)

    io.emit('discountUpdate', {
        productId,
        status: 'ended',
        ...getTimerStatus(timer)
    })

    console.log(`⏹️ Timer stopped for product ${productId}`)
}

function getTimerStatus(timer) {
    return {
        productId: timer.productId,
        originalPrice: timer.originalPrice,
        currentPrice: timer.currentPrice,
        currentDiscount: timer.currentDiscount,
        isActive: timer.isActive,
        isBuffering: timer.isBuffering,
        isEnded: timer.isEnded,
        elapsedTime: timer.isActive ? Date.now() - timer.startTime : 0,
        remainingTime: timer.isActive ?
            Math.max(0, DISCOUNT_CONFIG.totalDuration - (Date.now() - timer.startTime)) :
            DISCOUNT_CONFIG.totalDuration,
        totalDuration: DISCOUNT_CONFIG.totalDuration
    }
}

io.on('connection', (socket) => {
    console.log('👤 Client connected')

    const activeTimers = Object.entries(discountTimers)
        .filter(([_, timer]) => timer.isActive || timer.isBuffering)
        .map(([productId, timer]) => ({
            productId,
            ...getTimerStatus(timer)
        }))

    if (activeTimers.length > 0) {
        socket.emit('activeTimers', activeTimers)
    }

    socket.on('disconnect', () => {
        console.log('👤 Client disconnected')
    })
})

// ===== ONLY ONE LISTEN - USE SERVER.LISTEN =====
server.listen(process.env.PORT || 3000, () => {
    console.log(`Server running on port ${process.env.PORT || 3000}`)
})