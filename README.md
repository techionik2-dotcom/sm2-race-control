# SM Racing

## Overview

SM Racing is a full stack race-operations web application built to support motorsport event management, structured submissions, admin review workflows, and AI-assisted data handling. The project combines a Next.js frontend with a FastAPI backend and is designed for race teams or operations staff who need cleaner event data, faster review cycles, and more reliable reporting workflows.

## Key Features

- Event, driver, track, vehicle, and run-group management
- Participant-facing submission and event workflow screens
- Voice submission and structured note capture flows
- OCR review and staged intake for image-based data extraction
- Admin dashboard for reviewing and managing race submissions
- AI-assisted chatbot and support workflows for internal review use cases
- JWT-based authentication and role-aware admin flows
- PostgreSQL-backed FastAPI API with Alembic migrations
- Optional Make.com OCR and OpenAI transcription integration points

## Tech Stack

- Next.js
- React
- JavaScript
- Material UI
- FastAPI
- PostgreSQL
- SQLAlchemy
- Alembic
- Playwright

## Business Use Case

This repository fits teams or organizations that need a specialized web application for race operations, structured field-data capture, workflow automation, admin review, and reporting support around live events.

## Repository Structure

- `app/` - Next.js frontend routes and user/admin workflows
- `backend/` - FastAPI backend, database models, and business services
- `components/` - shared frontend UI components
- `tests/` - end-to-end test coverage
- `scripts/` - local development helpers

## Setup

Install frontend dependencies:

```bash
npm install
```

Install backend dependencies:

```bash
python -m pip install -r backend/requirements.txt
```

Run both frontend and backend together:

```bash
npm run dev:full
```

Useful alternatives:

```bash
npm run dev
npm run dev:backend
```

## Project Status

Active full stack product in development. The repository already contains substantial frontend, backend, admin, and automation workflows, with the backend in `backend/` serving as the canonical API implementation.

## Future Improvements

- Expanded analytics and reporting for events and submissions
- Broader mobile-first capture workflows for trackside use
- Additional deployment and infrastructure documentation
- More screenshot-driven product documentation for GitHub visitors

## Maintainer

- Techionik / Tekonic
