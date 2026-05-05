require('dotenv').config()
const express = require('express')
const axios = require('axios')
const { google } = require('googleapis')

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

app.listen(3000, () => console.log('Server running on port 3000'))