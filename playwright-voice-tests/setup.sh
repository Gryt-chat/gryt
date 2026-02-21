#!/bin/bash

echo "🎙️ Setting up Voice Chat Playwright Tests..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Please run this script from the playwright-voice-tests directory"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Install Playwright browsers
echo "🌐 Installing Playwright browsers..."
npx playwright install

# Make audio analyzer executable
chmod +x audio-analyzer.js

echo "✅ Setup complete!"
echo ""
echo "🚀 Next steps:"
echo "1. Start your servers:"
echo "   - WebSocket server: cd ../server && npm run dev"
echo "   - SFU server: cd ../sfu-v2 && go run main.go"
echo "   - Client: cd ../client && npm run dev"
echo ""
echo "2. Run the tests:"
echo "   npm test                    # Run all tests"
echo "   npm run test:voice          # Run voice transmission test"
echo "   npm run test:headed         # Run with browser UI"
echo "   npm run test:debug          # Run in debug mode"
echo ""
echo "3. Check the results in the test reports!"
