const express = require("express")
const cors = require("cors")
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { query } = require("express");
require('dotenv').config()
const jwt = require("jsonwebtoken")
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);



const app = express()
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

app.get("/", async (req, res) => {
    res.send("Server is OKay")
})
app.listen(port, () => {
    console.log("server is running on port", port);
})


const uri = process.env.DB_URL;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization
    // console.log(authHeader)
    if (!authHeader) {
        return res.status(401).send("unAuthorized Access")
    }
    const token = authHeader.split(" ")[1]
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send("Forbidden access")
        }
        req.decoded = decoded
        next()
    });

}

const run = async () => {
    const appointmentCollection = client.db("doctors_portal_db").collection("appointment_db")
    const bookingsCollection = client.db("doctors_portal_db").collection("bookings_db")
    const usersCollection = client.db("doctors_portal_db").collection("users_db")
    const doctorsCollection = client.db("doctors_portal_db").collection("doctors_db")
    const paymentCollection = client.db("doctors_portal_db").collection("payment_db")

    const verifyAdmin = async (req, res, next) => {
        const email = req.decoded.email
        const userQuery = { email: email }
        const user = await usersCollection.findOne(userQuery)
        // console.log(user.role);
        if (user?.role !== "Admin") {
            return res.status(403).send("Unauthorized Access")
        }

        next()
    }
    try {
        app.get('/appointments', async (req, res) => {
            const query = {}
            const date = req.query.date
            const options = await appointmentCollection.find(query).toArray()
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray()
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name)
                const bookedSlot = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlot.includes(slot))
                option.slots = remainingSlots
                // console.log(date, remainingSlots)
            })
            res.send(options)
        })
        // app.get("/addPrice", async (req, res) => {
        //     const filter = {}
        //     const options = { upsert: true }
        //     const updatePrice = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentCollection.updateMany(filter, updatePrice, options)
        //     res.send(result)
        // })

        app.get('/doctorSpecialty', async (req, res) => {
            const query = {}
            const specialties = await appointmentCollection.find(query).project({ name: 1 }).toArray()
            res.send(specialties)
        })

        app.get("/bookings", verifyJWT, async (req, res) => {
            const email = req.query.email
            const decoded = req.decoded

            if (email !== decoded.email) {
                return res.status(403).send("Forbidden Access")
            }

            const query = { email }
            const bookings = await bookingsCollection.find(query).toArray()
            res.send(bookings)

        })
        app.get('/bookings/:id', async (req, res) => {

            const id = req.params.id

            const query = { _id: ObjectId(id) }
            const bookings = await bookingsCollection.findOne(query)
            res.send(bookings)

        })

        app.post("/bookings", async (req, res) => {
            // query = {}
            const booking = req.body
            const query = {
                email: booking.email,
                treatment: booking.treatment,
                appointmentDate: booking.appointmentDate
            }
            const alreadyBooked = await bookingsCollection.find(query).toArray()
            // console.log(alreadyBooked);
            if (alreadyBooked.length) {
                const message = `You have already booked an appointment on ${booking.appointmentDate}`
                return res.send({ acknowledged: false, message })
            }
            const result = await bookingsCollection.insertOne(booking)
            res.send(result)
        })

        app.post("/create-payment-intent", async (req, res) => {
            const booking = req.body
            const price = booking.price
            // console.log(price);
            const amount = price * 100

            const paymentIntent = await stripe.paymentIntents.create({
                currency: "usd",
                amount: amount,
                "payment_method_types": [
                    "card"
                ],
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });

        })

        app.post('/payment', async (req, res) => {
            const payment = req.body
            const result = await paymentCollection.insertOne(payment)
            const id = payment.bookingId
            const filter = { _id: ObjectId(id) }
            const updatePayment = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedBooking = await bookingsCollection.updateOne(filter, updatePayment)

            res.send(result)
        })


        app.post("/users", async (req, res) => {
            const user = req.body
            // console.log(user)
            const result = await usersCollection.insertOne(user)
            res.send(result)
        })
        app.get("/users/admin/:email", verifyJWT, async (req, res) => {
            const decodedEmail = req.decoded.email
            const userEmail = req.params.email
            if (decodedEmail !== userEmail) {
                return res.status(403).send("Forbidden Access")
            }
            const query = { email: userEmail }
            const user = await usersCollection.findOne(query)
            // console.log(user);
            res.send({ isAdmin: user?.role === "Admin" })
        })

        app.put("/users/:id", verifyJWT, async (req, res) => {
            const id = req.params.id
            const decodedEmail = req.decoded.email
            const query = { email: decodedEmail }
            const user = await usersCollection.findOne(query)
            console.log(user);
            if (user.role !== "Admin") {
                return res.status(403).send("Forbidden Acess")
            }
            const filter = { _id: ObjectId(id) }
            const option = { upsert: true }
            const updatedRole = {
                $set: {
                    role: "Admin"
                }
            }
            const result = await usersCollection.updateOne(filter, updatedRole, option)
            // console.log(user)
            res.send(result)

        })

        app.get("/allUsers", verifyJWT, async (req, res) => {
            const decodedEmail = req.decoded.email

            const query = {}

            const users = await usersCollection.find(query).toArray()
            // console.log(users);
            res.send(users)
        })

        app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {

            const doctor = req.body
            const result = await doctorsCollection.insertOne(doctor)
            res.send(result)

        })
        app.get("/doctor", verifyJWT, verifyAdmin, async (req, res) => {

            const query = {}
            const result = await doctorsCollection.find(query).toArray()
            res.send(result)
        })
        app.delete("/doctor/:id", verifyJWT, verifyAdmin, async (req, res) => {

            const id = req.params.id
            const query = { _id: ObjectId(id) }
            // console.log(query);
            const result = await doctorsCollection.deleteOne(query)
            res.send(result)
        })

        app.get("/jwt", async (req, res) => {
            const email = req.query.email
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '10h' })
                return res.send({ accessToken: token })
            }
            return res.status(403).send({ accesToken: "" })
        })
    } finally {

    }
}
run().catch(err => console.log(err))