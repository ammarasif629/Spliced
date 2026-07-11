# Quick setup

```bash
cd spliced
npm install
```

You can also add the API key later from the Settings page after the app is running.

If you want to set it in the environment instead, create a local env file:

```bash
# .env.local
OPENAI_API_KEY=your_key_here
```

If you do not set an API key, the app will use its mock provider.

Run the app:

```bash
npm run dev
```

Open http://localhost:3000
