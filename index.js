require('dotenv').config()
const express = require('express')
const axios = require('axios')
const { google } = require('googleapis')
const cheerio = require('cheerio')

const app = express()
app.use(express.json())

app.get('/', (req, res) => {
    res.send('Server is running ✅')
})

// =====================================================================
// Q1 - Integrate Delhivery logistics API with a Shopify store to
//      automate shipment creation and store tracking (waybill) details
//      in Google Sheets
// =====================================================================

// Q1 - Point 1: Set up Shopify webhook for order creation
// Q1 - Point 4: Extract and store waybill/reference ID from Delhivery response
// Q1 - Point 5: Save shipment details in Google Sheets via API
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

// Q1 - Point 2: Integrate Delhivery API (authentication + shipment creation)
// Q1 - Point 3: Build backend endpoint (Node.js) to process order data and create shipment
// Q1 - Point 6: Add error handling and retry mechanism for failed shipments
app.post('/webhook/order', async (req, res) => {
    const order = req.body
    try {
        // Q1 - Point 2: Delhivery API authentication + shipment creation
        // 🧪 MOCK - Remove this when you have real Delhivery token
        const waybill = 'MOCK-WAYBILL-' + order.id

        // Q1 - Point 5: Save shipment details in Google Sheets
        await saveToSheets(order.id, waybill)

        res.status(200).json({
            success: true,
            waybill: waybill,
            message: 'Shipment created successfully'
        })

    } catch (err) {
        // Q1 - Point 6: Error handling for failed shipments
        console.error('Error:', err.message)
        res.status(500).send('Error creating shipment')
    }
})

// =====================================================================
// Q2 - Integrate Eshopbox logistics API with a Shopify store to fetch
//      real-time shipping rates based on customer pincode and cart weight,
//      display them at checkout, and automate order creation in Eshopbox
//      after order placement
// =====================================================================

// Q2 - Point 1: Set up Shopify Carrier Service API for dynamic shipping rates
// Q2 - Point 2: Integrate Eshopbox API (authentication + rate fetching)
// Q2 - Point 3: Build backend endpoint to process pincode and weight and return shipping cost
// Q2 - Point 4: Display real-time shipping charges at checkout
// Q2 - Point 6: Add basic error handling and fallback shipping logic
app.post('/shipping/rates', async (req, res) => {
    const { rate } = req.body

    // Q2 - Point 3: Extract pincode and weight from Shopify request
    const pincode = rate.destination.postal_code
    const weight = rate.total_weight

    try {
        // Q2 - Point 2: Eshopbox API authentication + rate fetching
        const eshopbox = await axios.get('https://api.eshopbox.com/shipping/rates', {
            params: { pincode, weight },
            headers: { Authorization: `Bearer ${process.env.ESHOPBOX_TOKEN}` }
        })

        // Q2 - Point 4: Return rates to display at Shopify checkout
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
        // Q2 - Point 6: Error handling + fallback shipping rate
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

// Q2 - Point 5: Implement webhook to send order details from Shopify to Eshopbox automatically
app.post('/webhook/eshopbox-order', async (req, res) => {
    const order = req.body
    try {
        // Q2 - Point 5: Send order to Eshopbox after placement
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
        // Q2 - Point 6: Error handling
        console.error('Eshopbox order error:', err.message)
        res.status(500).send('Error')
    }
})

// =====================================================================
// Q3 - Website Data & Sales Tracking Sheet
// Track daily active users, sales, and cancel/return orders
// =====================================================================

// Store daily data in memory
let dailyData = {
    date: new Date().toLocaleDateString(),
    activeUsers: 0,
    totalSales: 0,
    cancelledOrders: 0
}

// Q3 - Point 1: Track daily active users (via checkout creation)
app.post('/webhook/checkout', async (req, res) => {
    try {
        const today = new Date().toLocaleDateString()
        if (dailyData.date !== today) {
            // Save previous day data and reset
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

// Q3 - Point 2: Track daily sales (via order creation)
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

// Q3 - Point 3: Track cancelled/return orders
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

// Save daily tracking data to Google Sheet
async function saveTrackingToSheets(data) {
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
}

// Q3 - Endpoint to manually check current daily data
app.get('/tracking', (req, res) => {
    res.json(dailyData)
})

// Manual save for testing
app.get('/save-tracking', async (req, res) => {
    try {
        await saveTrackingToSheets(dailyData)
        res.json({ success: true, data: dailyData })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

// Store return requests in memory
let returnRequests = []

// Q4 - Point 2: Handle return request submission
app.post('/return-request', async (req, res) => {
    const { order_id, order_number, product_name, customer_email, reason } = req.body
    try {
        // Q4 - Point 3: Track return status
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

        // Redirect back to returns page
        res.redirect('https://fzmmyj-k4.myshopify.com/pages/returns?success=true')

    } catch (err) {
        console.error('Return request error:', err.message)
        res.status(500).send('Error submitting return request')
    }
})

// Q4 - Point 3: Get return requests for a customer
app.get('/return-requests/:email', (req, res) => {
    const email = req.params.email
    const customerReturns = returnRequests.filter(r => r.customer_email === email)
    res.json(customerReturns)
})

// =====================================================================
// Q5 - Website Data Export
// Export all website pages data into Google Sheets
// Data: URL, Title, Meta description, H1, Images
// =====================================================================
// Q5 - Fetch and parse a single page
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

// Q5 - Save page data to Google Sheet ()
async function savePageDataToSheets(pages) {
    const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    })
    const sheets = google.sheets({ version: 'v4', auth })
    const spreadsheetId = '1BhqYVQfkQrU_z2WHRnlBaeUoF0fRZsvEH2TFTQBdUXs'

    try {
        // Check if 'pages' sheet exists and if headers are present
        const existingData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'pages!A1:F1'
        }).catch(() => null)

        // Only add headers if sheet is empty or first row doesn't have headers
        if (!existingData || !existingData.data.values || existingData.data.values.length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: 'pages!A1:F1',
                valueInputOption: 'RAW',
                resource: {
                    values: [['URL', 'Title', 'Meta Description', 'H1', 'Image Count', 'Image URLs']]
                }
            })
        }

        // Find the next empty row
        const sheetData = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'pages!A:F'
        })

        const nextRow = sheetData.data.values ? sheetData.data.values.length + 1 : 2

        // Prepare data rows
        const rows = pages.map(p => [
            p.url || '',
            p.title || '',
            p.meta_description || '',
            p.h1 || '',
            p.image_count !== undefined ? p.image_count.toString() : '0',
            p.image_urls || ''
        ])

        // Append data at the correct position
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `pages!A${nextRow}:F${nextRow + rows.length - 1}`,
            valueInputOption: 'RAW',
            resource: { values: rows }
        })

    } catch (err) {
        console.error('Sheet save error:', err.message)
        throw err
    }
}

// Q5 - Endpoint to trigger data export ()
app.get('/export-pages', async (req, res) => {
    try {
        // List of your store pages to export
        const pages = [
            'https://fzmmyj-k4.myshopify.com',
            'https://fzmmyj-k4.myshopify.com/collections/all',
            'https://fzmmyj-k4.myshopify.com/pages/returns',
            'https://fzmmyj-k4.myshopify.com/pages/contact'
        ]

        // Fetch data for all pages
        const pageData = []
        for (const url of pages) {
            try {
                const data = await fetchPageData(url)
                pageData.push(data)
                console.log(`Fetched: ${url}`)
            } catch (err) {
                console.error(`Failed to fetch ${url}:`, err.message)
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

        // Save to Google Sheet
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
// Total timer: 15 minutes, Discount increases 2% every 1 minute
// Timer starts after buffer time, Discount stops before timer ends
// =====================================================================

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

// Handle preflight requests
app.options('*', cors())

// Store active discount timers
let discountTimers = {}

// Product discount configuration
const DISCOUNT_CONFIG = {
    totalDuration: 15 * 60 * 1000,  // 15 minutes in milliseconds
    discountIncrement: 2,            // 2% per minute
    incrementInterval: 60 * 1000,    // 1 minute in milliseconds
    bufferTime: 30 * 1000,           // 30 seconds buffer before start
    stopBeforeEnd: 2 * 60 * 1000,    // Stop 2 minutes before timer ends
    maxDiscount: 30                   // Maximum 30% discount (15 min × 2%)
}

// Q6 - API to start a discount timer for a product
app.post('/discount/start', (req, res) => {
    const { productId, originalPrice } = req.body

    if (!productId || !originalPrice) {
        return res.status(400).json({
            error: 'productId and originalPrice are required'
        })
    }

    // Stop any existing timer for this product
    if (discountTimers[productId]) {
        clearInterval(discountTimers[productId].interval)
        clearTimeout(discountTimers[productId].startTimeout)
        clearTimeout(discountTimers[productId].endTimeout)
    }

    // Initialize timer data
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

    // Buffer time before starting the actual timer
    timerData.startTimeout = setTimeout(() => {
        timerData.isBuffering = false
        timerData.isActive = true
        timerData.startTime = Date.now()

        console.log(`✅ Timer started for product ${productId}`)

        // Emit timer started event
        io.emit('discountUpdate', {
            productId,
            status: 'started',
            ...getTimerStatus(timerData)
        })

        // Start discount increments
        timerData.interval = setInterval(() => {
            if (timerData.isActive && !timerData.isEnded) {
                // Increase discount by 2%
                timerData.currentDiscount = Math.min(
                    timerData.currentDiscount + DISCOUNT_CONFIG.discountIncrement,
                    DISCOUNT_CONFIG.maxDiscount
                )

                // Calculate new price
                timerData.currentPrice = timerData.originalPrice *
                    (1 - timerData.currentDiscount / 100)
                timerData.currentPrice = Math.round(timerData.currentPrice * 100) / 100

                // Update elapsed and remaining time
                timerData.elapsedTime = Date.now() - timerData.startTime
                timerData.remainingTime = DISCOUNT_CONFIG.totalDuration - timerData.elapsedTime

                console.log(`Product ${productId}: ${timerData.currentDiscount}% discount - $${timerData.currentPrice}`)

                // Emit update to all connected clients
                io.emit('discountUpdate', {
                    productId,
                    status: 'active',
                    ...getTimerStatus(timerData)
                })

                // Check if we should stop discount before timer ends
                if (timerData.elapsedTime >= (DISCOUNT_CONFIG.totalDuration - DISCOUNT_CONFIG.stopBeforeEnd)) {
                    stopDiscountTimer(productId)
                }
            }
        }, DISCOUNT_CONFIG.incrementInterval)

    }, DISCOUNT_CONFIG.bufferTime)

    // Auto-stop timer after total duration
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

// Q6 - API to get current discount status
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

// Q6 - API to stop discount timer manually
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

// Q6 - API to get all active timers
app.get('/discount/active', (req, res) => {
    const activeTimers = Object.entries(discountTimers)
        .filter(([_, timer]) => timer.isActive)
        .map(([productId, timer]) => ({
            productId,
            ...getTimerStatus(timer)
        }))

    res.json(activeTimers)
})

// Helper function to stop discount timer
function stopDiscountTimer(productId) {
    const timer = discountTimers[productId]
    if (!timer) return

    timer.isActive = false
    timer.isEnded = true
    clearInterval(timer.interval)
    clearTimeout(timer.startTimeout)
    clearTimeout(timer.endTimeout)

    // Keep final discount for a while, then reset
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
    }, 5 * 60 * 1000) // Keep price for 5 minutes after timer ends

    io.emit('discountUpdate', {
        productId,
        status: 'ended',
        ...getTimerStatus(timer)
    })

    console.log(`⏹️ Timer stopped for product ${productId}`)
}

// Helper function to get timer status
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

// Q6 - WebSocket connection handler
io.on('connection', (socket) => {
    console.log('👤 Client connected')

    // Send current active timers to newly connected client
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

// Update app.listen to use server instead
// Replace: app.listen(3000, () => console.log('Server running on port 3000'))
// With:
server.listen(process.env.PORT || 3000, () => {
    console.log(`Server running on port ${process.env.PORT || 3000}`)
})

app.listen(3000, () => console.log('Server running on port 3000'))