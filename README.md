# CampusOptimizer Reporting System v2.0

Modern, scalable reporting system using **React + Vite + Vercel Serverless Functions**.

## 🎯 What's New

- ✅ **Vercel Serverless Functions** - No server management required
- ✅ **React + Vite Frontend** - Fast, modern UI
- ✅ **Vercel KV Caching** - Global Redis for performance
- ✅ **Auto-scaling** - Handle any load automatically
- ✅ **Git-based Deployments** - Push to deploy
- ✅ **$0-20/month** - Cost-effective vs traditional hosting

## 📚 Documentation

### Quick Start

1. **[VERCEL_MIGRATION_SUMMARY.md](VERCEL_MIGRATION_SUMMARY.md)** - Start here! 10-minute overview
2. **[VERCEL_SETUP.md](VERCEL_SETUP.md)** - Step-by-step setup guide
3. **[QUICK_START_GUIDE.md](QUICK_START_GUIDE.md)** - Quick start options

### Architecture & Implementation

4. **[VERCEL_ARCHITECTURE.md](VERCEL_ARCHITECTURE.md)** - Complete Vercel architecture
5. **[ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md)** - Original architecture proposal
6. **[IMPLEMENTATION_CHECKLIST.md](IMPLEMENTATION_CHECKLIST.md)** - Task checklist

### Examples

7. **[examples/vercel-api/](examples/vercel-api/)** - Vercel serverless function examples
8. **[examples/frontend/](examples/frontend/)** - React component examples
9. **[examples/README.md](examples/README.md)** - Examples documentation

## 🚀 Quick Setup (10 Commands)

```bash
# 1. Install Vercel CLI
pnpm add -g vercel

# 2. Install dependencies
pnpm install

# 3. Login to Vercel
vercel login

# 4. Link project
vercel link

# 5. Setup directories
mkdir -p api/reports api/analytics api/pelican api/co
mkdir -p lib/services

# 6. Copy Vercel API examples
cp -r examples/vercel-api/* api/

# 7. Copy shared libraries
cp lib/services/cache.js lib/services/
cp lib/co-client.js lib/

# 8. Setup environment variables
vercel env add CO_ENVIRONMENT
vercel env add CO_MASTER_KEY

# 9. Create Vercel KV database
# Dashboard → Storage → Create KV Database

# 10. Deploy!
vercel --prod
```

## 🏗️ Architecture Overview

```
Frontend (React + Vite)
    ↓ API Calls
Vercel Serverless Functions
    ↓ Data Fetching
Campus Optimizer API + Pelican Data
    ↓ Caching
Vercel KV (Global Redis)
```

### API Endpoints

```
GET /api/devices/[clientId]
GET /api/dates/[clientId]
GET /api/units
GET /api/meters/[clientId]
GET /api/intervals/[clientId]
GET /api/schedules/[clientId]/[date]
GET /api/schedule-details/[clientId]/[date]
GET /api/buildings/[clientId]
GET /api/pelican/thermostats/[clientId]
GET /api/pelican/history/[clientId]
```

## 📁 Project Structure

```
phase-2/
├── api/                          # Vercel serverless functions
│   ├── devices/
│   ├── dates/
│   ├── units/
│   ├── meters/
│   ├── intervals/
│   ├── schedules/
│   ├── schedule-details/
│   ├── buildings/
│   ├── pelican/
│   └── analytics/
├── lib/                          # Shared libraries
│   ├── co-client.js
│   └── services/
│       ├── aggregation.js
│       └── cache.js
├── src/                          # Frontend (React + Vite)
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   └── services/
├── examples/                     # Example implementations
│   ├── vercel-api/
│   └── frontend/
├── vercel.json                   # Vercel configuration
├── package.json
└── README.md                     # This file
```

## 🔧 Development

### Local Development

**Option 1: Use Vercel Dev Server (Recommended for API development)**
```bash
# Start Vercel dev server (simulates serverless environment)
vercel dev
```

**Option 2: Frontend Only with Hosted API (Recommended for frontend development)**
```bash
# Run frontend only, pointing to hosted Vercel API
# Create .env.local file with:
# VITE_API_BASE_URL=https://phase-2-tan.vercel.app/api
pnpm dev
```

The `.env.local` file (already in `.gitignore`) allows you to point your local frontend to the deployed Vercel API endpoints. This is useful when you only need to work on the frontend and don't want to run the serverless functions locally.

### Testing

```bash
# Test devices endpoint
curl http://localhost:3000/api/devices/1420

# Test dates endpoint
curl http://localhost:3000/api/dates/1420
```

### Deployment

```bash
# Deploy to preview
vercel

# Deploy to production
vercel --prod

# Or use Git integration
git push origin main  # Auto-deploys!
```

## 💰 Cost

### Vercel Pricing

**Hobby (Free):**

- 100GB bandwidth/month
- 100 hours serverless execution
- Perfect for development

**Pro ($20/month):**

- 1TB bandwidth
- 1000 hours serverless execution
- Team collaboration
- Recommended for production

## 📊 Performance

- ⚡ **Cold Start:** ~100ms
- 🌍 **Global CDN:** Edge deployment
- 💾 **Cache:** Global Redis (Vercel KV)
- 📈 **Scaling:** Automatic

## 🔒 Security

- ✅ Environment variables in Vercel dashboard
- ✅ Secrets never committed to git
- ✅ CORS configured
- ✅ Rate limiting available
- ✅ HTTPS by default

## 📈 Monitoring

Vercel Dashboard provides:

- Real-time function logs
- Execution time metrics
- Error tracking
- Cache performance
- Traffic analytics

## 🛠️ Tech Stack

### Frontend

- React 18
- Vite 5
- Tailwind CSS
- Chart.js
- React Router

### Backend

- Vercel Serverless Functions
- Node.js 18
- Vercel KV (Redis)

### External APIs

- Campus Optimizer API
- Pelican API

## 📝 Environment Variables

Required in Vercel Dashboard:

1. `CO_ENVIRONMENT` - Campus Optimizer environment
2. `CO_MASTER_KEY` - Campus Optimizer API key

Auto-added by Vercel KV:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

## 🐛 Troubleshooting

### Common Issues

1. **Function timeout**

   - Increase `maxDuration` in `vercel.json`

2. **KV connection fails**

   - Run `vercel env pull .env.local`

3. **CORS errors**
   - Check `vercel.json` headers section

See [VERCEL_SETUP.md](VERCEL_SETUP.md) for detailed troubleshooting.

## 📚 Learn More

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel KV](https://vercel.com/docs/storage/vercel-kv)
- [Vite Guide](https://vitejs.dev/guide/)
- [React Documentation](https://react.dev/)

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Deploy to preview: `vercel`
4. Submit a pull request

## 📄 License

ISC

## 🎉 Getting Started

**New to the project?**

1. Read [VERCEL_MIGRATION_SUMMARY.md](VERCEL_MIGRATION_SUMMARY.md) (5 min)
2. Follow [VERCEL_SETUP.md](VERCEL_SETUP.md) (10 min)
3. Run `vercel dev` and start developing!

**Questions?** Check the documentation or open an issue.

---

**Ready to deploy?**

```bash
vercel login
vercel link
vercel --prod
```

🚀 **Your app will be live in ~2 minutes!**
