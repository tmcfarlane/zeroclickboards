# Contributing to ZeroBoard

We welcome contributions from the community! ZeroBoard is open source and we believe in the power of collaborative development.

## How Feature Requests Work

1. **Submit a feature request** via [the feedback page](https://board.zeroclickdev.ai/feedback) or by creating a GitHub issue
2. A GitHub issue is created automatically (if submitted via the feedback page)
3. An AI Agent picks it up and begins working on it
4. Project owners and contributors review the AI's PR
5. The AI iterates based on PR feedback
6. The feature is approved and shipped

We genuinely encourage you to submit feature requests. You might be surprised how quickly they get built.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/zeroclickboards.git`
3. Install dependencies: `npm install`
4. Copy `.env.example` to `.env` and fill in your Supabase credentials
5. Start the dev server: `npm run dev`

## Development

- **Tech Stack**: React 19, TypeScript, Vite 7, Tailwind CSS, shadcn/ui, Supabase, Zustand
- **Database**: Supabase PostgreSQL with Row Level Security
- **Deployment**: Vercel (serverless functions in `/api`)
- **Styling**: Dark theme with cyan accent (`#78fcd6`)

## Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Ensure `npm run build` passes with no type errors
4. Submit a pull request with a clear description of your changes

## Code Style

- TypeScript strict mode
- Functional React components with hooks
- Tailwind CSS for styling (no CSS modules)
- Follow existing patterns in the codebase

## Bug Reports

Please report bugs by creating a GitHub issue with:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if applicable)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
