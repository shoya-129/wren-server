# Wren Server API Documentation

Wren Server is a NestJS backend designed around secure, client-side encrypted communication. This documentation describes how user follow flows, post feeds, and cryptographic keys interact.

---

## 🔑 Authentication

All protected routes require a Bearer Token in the `Authorization` header.

```http
Authorization: Bearer <JWT_TOKEN>
```

When you register or log in, you receive an `accessToken`. This token contains a payload with `sub` mapping to the user's unique `uid`.

---

## 🛠️ Setup & Running

- **Install dependencies**: `npm install`
- **Run dev server**: `npm run start:dev`
- **Lint code**: `npm run lint`
- **Build application**: `npm run build`

---

## 📡 API Endpoints Reference

### 1. Auth Module (`/auth`)

#### Register User
* **Method & URL**: `POST /auth/register`
* **Content-Type**: `application/json`
* **Body Schema**:
  ```json
  {
    "username": "alice",
    "email": "alice@example.com",
    "password": "strongpassword",
    "publicKey": "base64-or-hex-rsa-public-key",
    "encryptedPrivateKey": "base64-or-hex-aes-encrypted-private-key",
    "encryptedFeedKey": "base64-or-hex-aes-encrypted-user-feed-key",
    "salt": "password-derivation-salt"
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "user": {
      "uid": "uuid-string",
      "username": "alice",
      "email": "alice@example.com",
      "publicKey": "...",
      "encryptedFeedKey": "..."
    },
    "accessToken": "jwt-token-string",
    "message": "User created successfully",
    "statusCode": 201
  }
  ```

#### Login User
* **Method & URL**: `POST /auth/login`
* **Content-Type**: `application/json`
* **Body Schema**:
  ```json
  {
    "identifier": "alice", // Can be username or email
    "password": "strongpassword"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "user": { ... },
    "accessToken": "jwt-token-string",
    "message": "Logged in successfully",
    "statusCode": 200
  }
  ```

---

### 2. User & Follow Module (`/user`)

All routes in this module require the JWT Bearer Token in the headers.

#### Get Current User Profile
* **Method & URL**: `GET /user/profile`
* **Response (200 OK)**:
  ```json
  {
    "uid": "alice-uuid",
    "username": "alice",
    "email": "alice@example.com",
    "publicKey": "alice-public-key",
    "encryptedPrivateKey": "alice-enc-private-key",
    "encryptedFeedKey": "alice-enc-feed-key",
    "salt": "alice-salt",
    "verified": false,
    "accountStatus": "active",
    "createdAt": "2026-07-01T...",
    "updatedAt": "2026-07-01T..."
  }
  ```

#### Get All Users
* **Method & URL**: `GET /user/all`
* **Response (200 OK)**:
  ```json
  [
    {
      "uid": "alice-uuid",
      "username": "alice",
      "publicKey": "alice-public-key"
    },
    {
      "uid": "bob-uuid",
      "username": "bob",
      "publicKey": "bob-public-key"
    }
  ]
  ```

#### Send Follow Request
* **Method & URL**: `POST /user/follow/:id`
  * `:id` represents the target user's `uid` (the person you want to follow).
* **Response (201 Created)**:
  ```json
  {
    "message": "Follow request sent successfully",
    "follow": {
      "followerId": "alice-uuid",
      "followingId": "bob-uuid",
      "status": "pending",
      "createdAt": "2026-07-01T..."
    }
  }
  ```

#### Get Pending Follow Requests
* **Method & URL**: `GET /user/follow/pending`
* **Description**: Lists all users who want to follow the logged-in user. Included in the response is the requester's `publicKey`, which is needed to encrypt the logged-in user's `feedKey`.
* **Response (200 OK)**:
  ```json
  [
    {
      "followerId": "alice-uuid",
      "status": "pending",
      "createdAt": "2026-07-01T...",
      "username": "alice",
      "name": "Alice Smith",
      "publicKey": "alice-public-key"
    }
  ]
  ```

#### Accept Follow Request
* **Method & URL**: `POST /user/follow/accept`
* **Description**: Accepts a follow request. User B accepts a follow request from User A by fetching User A's `publicKey` from the pending list, encrypting B's `feedKey` on-device, and passing it to this API.
* **Body Schema**:
  ```json
  {
    "followerId": "alice-uuid",
    "encryptedFeedKey": "bobs-feed-key-encrypted-with-alices-public-key"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "message": "Follow request accepted",
    "follow": {
      "followerId": "alice-uuid",
      "followingId": "bob-uuid",
      "status": "accepted",
      "encryptedFeedKey": "bobs-feed-key-encrypted-with-alices-public-key",
      "acceptedAt": "2026-07-01T..."
    }
  }
  ```

#### Reject Follow Request
* **Method & URL**: `POST /user/follow/reject`
* **Body Schema**:
  ```json
  {
    "followerId": "alice-uuid"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "message": "Follow request rejected",
    "follow": {
      "followerId": "alice-uuid",
      "followingId": "bob-uuid",
      "status": "rejected"
    }
  }
  ```

#### Unfollow User
* **Method & URL**: `POST /user/unfollow/:id`
  * `:id` represents the `uid` of the user you want to unfollow.
* **Response (200 OK)**:
  ```json
  {
    "message": "Unfollowed successfully"
  }
  ```

---

### 3. Posts Module (`/posts`)

Protected with JWT Bearer Token in headers.

#### Create Post
* **Method & URL**: `POST /posts`
* **Description**: Create a post with contents encrypted on the author's device using the author's feed key.
* **Body Schema**:
  ```json
  {
    "encryptedContent": "base64-or-hex-aes-encrypted-text",
    "encryptedMedia": "base64-or-hex-aes-encrypted-media-url", // Optional
    "replyTo": "parent-post-uuid", // Optional
    "quoteTo": "quoted-post-uuid", // Optional
    "visibility": "followers" // Default is "followers"
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "postId": "post-uuid",
    "uid": "author-uuid",
    "encryptedContent": "base64-or-hex-aes-encrypted-text",
    "encryptedMedia": "...",
    "replyTo": null,
    "quoteTo": null,
    "visibility": "followers",
    "createdAt": "2026-07-01T...",
    "updatedAt": "2026-07-01T..."
  }
  ```

#### Like Post (Toggle)
* **Method & URL**: `POST /posts/:id/like`
* **Description**: Toggles a like on post `:id` for the logged-in user. If the user previously disliked the post, the dislike record is automatically removed. Invalidates the feed cache.
* **Response (200 OK)**:
  * If Liked:
    ```json
    {
      "liked": true,
      "message": "Liked successfully"
    }
    ```
  * If Unliked:
    ```json
    {
      "liked": false,
      "message": "Unliked successfully"
    }
    ```

#### Dislike Post (Toggle)
* **Method & URL**: `POST /posts/:id/dislike`
* **Description**: Toggles a dislike on post `:id` for the logged-in user. If the user previously liked the post, the like record is automatically removed. Invalidates the feed cache.
* **Response (200 OK)**:
  * If Disliked:
    ```json
    {
      "disliked": true,
      "message": "Disliked successfully"
    }
    ```
  * If Dislike Removed:
    ```json
    {
      "disliked": false,
      "message": "Removed dislike successfully"
    }
    ```

#### Repost Post (Toggle)
* **Method & URL**: `POST /posts/:id/repost`
* **Description**: Toggles a repost on post `:id` for the logged-in user. Invalidates the feed cache.
* **Response (200 OK)**:
  * If Reposted:
    ```json
    {
      "reposted": true,
      "message": "Reposted successfully"
    }
    ```
  * If Unreposted:
    ```json
    {
      "reposted": false,
      "message": "Unreposted successfully"
    }
    ```

#### Create Comment / Reply
* **Method & URL**: `POST /posts/:id/comment`
* **Description**: Creates an encrypted comment/reply to post `:id`. Invalidates the feed cache.
* **Body Schema**:
  ```json
  {
    "encryptedContent": "base64-or-hex-aes-encrypted-text",
    "encryptedMedia": "base64-or-hex-aes-encrypted-media-url" // Optional
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "postId": "comment-post-uuid",
    "uid": "author-uuid",
    "encryptedContent": "base64-or-hex-aes-encrypted-text",
    "encryptedMedia": null,
    "replyTo": "parent-post-uuid",
    "quoteTo": null,
    "visibility": "followers", // Inherited from parent post
    "createdAt": "2026-07-01T...",
    "updatedAt": "2026-07-01T..."
  }
  ```


#### Get Secure Feed
* **Method & URL**: `GET /posts/feed?page=1&limit=20`
* **Query Parameters**:
  - `page`: Page index (default: `1`)
  - `limit`: Number of posts to fetch (default: `20`)
* **Description**: Fetches a chronological list of posts for the user's feed.
  - **Own Posts Excluded**: The user's own posts are never shown in their feed.
  - **Followed Posts Interleaved**: Followed users' posts (status: `accepted`) are interleaved with a smaller percentage (20%) of non-followed users' posts to fill the feed. If there are no followings, the feed defaults to non-followed posts.
  - **Keys & Decryption**:
    - For followed users: `encryptedFeedKey` contains their feed key encrypted specifically for the logged-in user (from the follows table).
    - For non-followed users: `encryptedFeedKey` is `null` (posts are un-decryptable and listed for public discovery).
  - **Engagement Counts**: Every post includes numeric counts for `likesCount`, `repostsCount`, and `repliesCount`.
  - **Cache Layer**: Feed requests are cached in-memory with a 10-second TTL. Follow state modifications (follow, unfollow, accept, reject) instantly invalidate the cache for the corresponding user.
* **Response (200 OK)**:
  ```json
  [
    {
      "postId": "post-uuid-1",
      "uid": "bob-uuid",
      "encryptedContent": "Bobs encrypted post content",
      "encryptedMedia": null,
      "replyTo": null,
      "quoteTo": null,
      "visibility": "followers",
      "createdAt": "2026-07-01T04:47:59.267Z",
      "updatedAt": "2026-07-01T04:47:59.267Z",
      "author": {
        "uid": "bob-uuid",
        "username": "bob",
        "name": "Bob Vance",
        "avatar": "url-to-avatar"
      },
      "encryptedFeedKey": "bobs-feed-key-encrypted-with-alices-public-key",
      "likesCount": 12,
      "repostsCount": 4,
      "repliesCount": 3
    },
    {
      "postId": "post-uuid-2",
      "uid": "charlie-uuid",
      "encryptedContent": "Charlie encrypted post content",
      "encryptedMedia": null,
      "replyTo": null,
      "quoteTo": null,
      "visibility": "followers",
      "createdAt": "2026-07-01T04:48:00.342Z",
      "updatedAt": "2026-07-01T04:48:00.342Z",
      "author": {
        "uid": "charlie-uuid",
        "username": "charlie",
        "name": "Charlie Green",
        "avatar": null
      },
      "encryptedFeedKey": null, // null because Alice does not follow Charlie
      "likesCount": 2,
      "repostsCount": 0,
      "repliesCount": 1
    }
  ]
  ```

---

## 🔒 Cryptographic Workflow Diagram

```
[Follower A]                                                       [Followed User B]
    │                                                                      │
    │  ── 1. POST /user/follow/B (Status: pending) ──────────────────────> │
    │                                                                      │
    │  <── 2. GET /user/follow/pending (Returns A's uid & publicKey) ──────│
    │                                                                      │
    │                                                        (Encrypts B's feedKey on-device)
    │                                                        (with A's publicKey)
    │                                                                      │
    │  <── 3. POST /user/follow/accept (followerId, encryptedFeedKey) ─────│
    │                                                                      │
    ├──────────────────────────────────────────────────────────────────────┤
    │                                                                      │
    │                     [Secure Feed Retrieval & Decryption]             │
    │                                                                      │
    │  ── 4. GET /posts/feed ────────────────────────────────────────────> │
    │  <── 5. Returns B's post + B's feedKey encrypted with A's publicKey ─│
    │                                                                      │
    │ (Decrypts feedKey with A's privateKey)                               │
    │ (Decrypts post content with decrypted feedKey)                       │
```
