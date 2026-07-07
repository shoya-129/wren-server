# Wren Server Contribution & Architecture Guide

Welcome to the development and contribution guide for `wren-server`. This document outlines the project's architecture, database layout, modules, services, custom decorators, guards, and styling rules. It serves as the primary resource for new developers onboarding to the codebase.

---

## 1. Project Overview & Tech Stack

`wren-server` is a secure, end-to-end encrypted microblogging backend built with the following core technologies:

- **Core Framework:** [NestJS](https://nestjs.com/) (TypeScript-first Node.js framework).
- **Database ORM:** [Drizzle ORM](https://orm.drizzle.team/) (Type-safe SQL query builder and schema mapper).
- **Database Client:** [postgres.js](https://github.com/porsager/postgres) (Fast PostgreSQL client for Node.js).
- **Authentication:** JWT (JSON Web Tokens) via `@nestjs/jwt`.
- **Media Uploads:** [Cloudinary](https://cloudinary.com/) (Used to store encrypted media attachments).
- **Caching:** Custom in-memory key-value cache with pattern-based invalidation.

---

## 2. Directory Structure

The structure of the `src` folder is organized into modules:

```text
src/
├── app.controller.ts    # Root controller (landing page)
├── app.service.ts       # Root service
├── app.module.ts        # App root module (aggregates other modules)
├── main.ts              # Server bootstrap file
├── auth/                # Authentication module (login, register, JWT generation)
│   ├── decorators/      # Auth-related parameter/route decorators
│   ├── dto/             # Data transfer objects for auth endpoints
│   ├── guards/          # JwtAuthGuard and AdminGuard
│   ├── interfaces/      # TypeScript interfaces for auth requests
│   ├── auth.controller.ts
│   ├── auth.module.ts
│   └── auth.service.ts
├── cache/               # Global in-memory cache module
│   ├── cache.module.ts
│   └── cache.service.ts
├── db/                  # Database client instantiation & Drizzle schemas
│   ├── index.ts
│   └── schema.ts
├── post/                # Post module (feeds, post creation, media uploading, reporting)
│   ├── dto/
│   ├── post.controller.ts
│   ├── post.module.ts
│   └── post.service.ts
└── user/                # User module (profiles, follows, user count, deletions)
    ├── dto/
    ├── user.controller.ts
    ├── user.module.ts
    └── user.service.ts
```

---

## 3. Database Layer & Schema

The relational schemas are defined using Drizzle ORM in [schema.ts](file:///c:/Users/clash/Desktop/projects/test/tql/wren-server/src/db/schema.ts).

### Key Tables:
- **`users`:** Holds user profiles, encrypted private keys, salt, verify state, and moderation details (status, suspension timestamp, admin permissions).
- **`follows`:** Represents the asymmetric follower network (follower and following UIDs, request status, and feed decryption keys).
- **`posts`:** Houses post content (encrypted text and media URLs), quote/reply mapping, visibility settings (`public` or `followers`), and soft deletion columns.
- **`likes` / `dislikes` / `reposts` / `bookmarks`:** Track user-to-post interactions.
- **`post_reports`:** Allows reporting of posts for moderation.

---

## 4. Custom Decorators & Guards

Security, user extraction, and routing rules are modularized through custom decorators and guards located in `src/auth`:

### Custom Decorators

1. **`@Public()`**  
   - **Location:** [public.decorator.ts](file:///c:/Users/clash/Desktop/projects/test/tql/wren-server/src/auth/decorators/public.decorator.ts)  
   - **Purpose:** Bypasses the class-level/global `JwtAuthGuard`. Routes decorated with `@Public()` are fully unauthenticated.
   - **CORS Effect:** When applied, `JwtAuthGuard` automatically appends wild-card CORS headers (`Access-Control-Allow-Origin: *`, allowed headers, and allowed methods) to the HTTP response, making it accessible from any origin.

2. **`@CurrentUser(key?: string)`**  
   - **Location:** [current-user.decorator.ts](file:///c:/Users/clash/Desktop/projects/test/tql/wren-server/src/auth/decorators/current-user.decorator.ts)  
   - **Purpose:** Custom NestJS parameter decorator to extract the parsed token payload (e.g. `@CurrentUser('sub') uid: string` gets the current user's UID).

### Guards

1. **`JwtAuthGuard`**  
   - **Location:** [jwt-auth.guard.ts](file:///c:/Users/clash/Desktop/projects/test/tql/wren-server/src/auth/guards/jwt-auth.guard.ts)  
   - **Purpose:** Checks the request headers for a `Bearer <JWT_TOKEN>`. It verifies the token and parses user status checks (re-activating suspended accounts if the suspension timestamp has elapsed or throwing forbidden exceptions for banned accounts).

2. **`AdminGuard`**  
   - **Location:** [admin.guard.ts](file:///c:/Users/clash/Desktop/projects/test/tql/wren-server/src/auth/guards/admin.guard.ts)  
   - **Purpose:** Restricts endpoint access to administrators only (`isAdmin: true`). Requires `JwtAuthGuard` to run beforehand.

---

## 5. Architectural Modules & Services

### `CacheService`
An in-memory key-value cache layer (`Map` based) with TTL (time-to-live) and custom pattern invalidation.
- **Feeds and Profiles caching:** Feeds are cached under keys like `feed:<uid>:<page>:<limit>`.
- **Invalidation:** When a user creates a post, likes a post, follow/unfollows someone, or deletes their account, pattern matching clears related keys (e.g., `this.cacheService.deletePattern("feed:")`) to ensure the cache stays coherent.

### `UserService`
Governs profile access, pagination queries, follower relations, and account life-cycles.
- **Live User Count Stream:** Manages a `BehaviorSubject<number>` representing the active count of registered users.
- **Lifecycle Integration:**
  - Seeds the subject using database query counts during startup (`onModuleInit`).
  - Emits real-time updates through `triggerUserCountUpdate()` when accounts are created (`createUser`) or deleted (`deleteAccount`).

### `PostService`
Regulates user timeline curation, visibility filters, and media uploading.
- **Media Uploads:** Integrates Cloudinary API to upload file buffers (with `.wren` encrypted formats) and returns secure URLs.

---

## 6. How to Develop & Contribute

### Environment Setup
Create a `.env` file in the root folder with the following variables:
```env
PORT=3000
DB_URI=postgresql://<user>:<password>@<host>:<port>/<database>
JWT_SECRET=your_jwt_secret_key
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

### Developing Locally
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the NestJS application in watch mode:
   ```bash
   npm run start:dev
   ```
3. Format code:
   ```bash
   npm run format
   ```
4. Build for production:
   ```bash
   npm run build
   ```

### Code Style Guidelines
- **Guards:** Protect controllers at the class level by default. Use `@Public()` for endpoints intended to be visible to unauthenticated users.
- **Cache Invalidation:** Always clean the relevant cached feeds (`feed:`) and user profiles (`user:`) when writing state-changing modifications.
- **Type-Safety:** Ensure all controllers validate inputs using NestJS class-validators/DTOs.
- **Drizzle Queries:** Keep database queries structured and clean. Utilize index columns for queries wherever possible.
