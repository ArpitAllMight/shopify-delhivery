require('dotenv').config()
const express = require('express')
const axios = require('axios')
const { google } = require('googleapis')

const app = express()
app.use(express.json())

// =====================
// Q1 - Delivery + Google Sheets
// =====================

async function saveToSheets(orderId, waybill) {
    const auth = new google.auth.GoogleAuth({
        keyFile: 'credentials.json',
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
        const shipment = await axios.post(
            'https://track.delhivery.com/api/cmu/create.json',
            {
                format: 'json',
                data: {
                    shipments: [{
                        name: order.shipping_address.name,
                        add: order.shipping_address.address1,
                        city: order.shipping_address.city,
                        state: order.shipping_address.province,
                        pin: order.shipping_address.zip,
                        phone: order.phone,
                        order: order.id,
                        payment_mode: 'Prepaid',
                        cod_amount: 0,
                        weight: 500
                    }]
                }
            },
            { headers: { Authorization: `Token ${process.env.DELHIVERY_TOKEN}` } }
        )

        const waybill = shipment.data.packages[0].waybill
        await saveToSheets(order.id, waybill)
        res.status(200).send('Shipment created')

    } catch (err) {
        console.error('Delhivery error:', err.message)
        res.status(500).send('Error creating shipment')
    }
})

// =====================
// Q2 - Eshopbox Shipping Rates
// =====================

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
        // Fallback rate
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

// =====================
// Q2 - Eshopbox Order Creation
// =====================

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

app.listen(3000, () => console.log('Server running on port 3000'))
