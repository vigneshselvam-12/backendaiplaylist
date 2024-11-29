const express = require('express');
const { MongoClient } = require('mongodb');
const SpotifyWebApi = require('spotify-web-api-node');

const app = express();
const port = 3001;

// Middleware to parse JSON
app.use(express.json());

// MongoDB Atlas connection string
const uri = 'mongodb+srv://vammbox:nZrqyxtzADw7ciSz@cluster0.a6zyl.mongodb.net/sample_mflix?retryWrites=true&w=majority';
const client = new MongoClient(uri);
let db, playlistCollection, usersCollection;

// Function to connect to MongoDB
async function connectDB() {
    try {
        await client.connect();
        db = client.db('sample_mflix'); // Use your database name here
        playlistCollection = db.collection('playlist');
        usersCollection = db.collection('users');
        console.log('Connected to MongoDB Atlas');
    } catch (error) {
        console.error('Error connecting to MongoDB Atlas:', error.message);
        process.exit(1); // Exit if database connection fails
    }
}

// Initialize Spotify API client
const spotifyApi = new SpotifyWebApi({
    clientId: '640ddf3eca3a4f7482844f1799a16a17',
    clientSecret: 'f55bbeafc6bb4b4297ac636453515a62',
    redirectUri: 'http://3.19.215.181:3001/callback', // Update this URI if needed
});

// Spotify login route
app.get('/login', (req, res) => {
    const { userId } = req.query;
    if (!userId) {
        return res.status(400).send('Missing userId query parameter');
    }

    const scopes = ['user-read-private', 'user-read-email', 'playlist-modify-public', 'playlist-modify-private'];
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes) + `&state=${userId}`;
    res.redirect(authorizeURL);
});

// Spotify callback route
app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    const userId = req.query.state;

    if (!userId) {
        console.error('Callback received without userId');
        return res.status(400).send('Missing userId in callback state');
    }

    try {
        const data = await spotifyApi.authorizationCodeGrant(code);
        const accessToken = data.body['access_token'];
        const refreshToken = data.body['refresh_token'];

        await usersCollection.updateOne(
            { userId },
            { $set: { accessToken, refreshToken, tokenExpiry: Date.now() + 3600 * 1000 } },
            { upsert: true }
        );

        console.log(`Tokens for user ${userId} stored in MongoDB`);
        res.send('Authentication successful! You can now close this page.');
    } catch (error) {
        console.error('Error during Spotify authentication:', error.message);
        res.status(500).send('Authentication failed');
    }
});

// Middleware to ensure user-specific access token is valid
async function ensureUserAccessToken(req, res, next) {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({ error: 'Missing userId in request' });
    }

    try {
        const user = await usersCollection.findOne({ userId });
        if (!user) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        spotifyApi.setRefreshToken(user.refreshToken);

        if (!spotifyApi.getAccessToken() || Date.now() > user.tokenExpiry) {
            const data = await spotifyApi.refreshAccessToken();
            const newAccessToken = data.body['access_token'];
            spotifyApi.setAccessToken(newAccessToken);

            await usersCollection.updateOne(
                { userId },
                { $set: { accessToken: newAccessToken, tokenExpiry: Date.now() + 3600 * 1000 } }
            );

            console.log(`Access token for user ${userId} refreshed`);
        } else {
            spotifyApi.setAccessToken(user.accessToken);
        }

        next();
    } catch (error) {
        console.error('Error ensuring access token:', error.message);
        res.status(500).send('Error ensuring access token');
    }
}

// Generate playlist route
app.post('/generatePlaylist', ensureUserAccessToken, async (req, res) => {
    const { userId } = req.query;
    const { keywords } = req.body;

    if (!keywords) {
        return res.status(400).json({ error: 'Missing keywords in request body' });
    }

    try {
        const data = await spotifyApi.searchTracks(keywords.trim().toLowerCase(), { limit: 10 });
        const tracks = data.body.tracks.items;

        await playlistCollection.insertMany(tracks);
        console.log(`Tracks saved to MongoDB Atlas for user ${userId}`);

        res.json({ message: 'Playlist generated successfully!', tracks });
    } catch (error) {
        console.error('Error generating playlist:', error.message);
        res.status(500).send('Error generating playlist');
    }
});

// Search tracks route
app.get('/searchTracks', ensureUserAccessToken, async (req, res) => {
    const { userId, keyword } = req.query;

    if (!keyword) {
        return res.status(400).json({ error: 'Missing keyword in query' });
    }

    try {
        const data = await spotifyApi.searchTracks(keyword, { limit: 10 });
        res.json(data.body.tracks.items);
    } catch (error) {
        console.error('Error searching tracks:', error.message);
        res.status(500).send('Error searching tracks');
    }
});

// Start the server after connecting to MongoDB
app.listen(port, '0.0.0.0', async () => {
    await connectDB();
    console.log(`Server running on http://3.19.215.181:${port}`);
});










