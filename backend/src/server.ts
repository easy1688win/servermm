import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import routes from './routes';
import sequelize from './config/database';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://antmarkerting.pages.dev',
    'https://api.megainfinite88.com'
  ],
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Trust proxy for rate limiting behind proxies (like Nginx, Cloudflare, or local dev proxy)
app.set('trust proxy', 1);

app.use('/api', routes);

app.get('/', (req, res) => {
  res.send('');
});

const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
};

if (require.main === module) {
  startServer();
}

export default app;
