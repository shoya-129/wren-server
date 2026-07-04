# Wren Server API Documentation

Wren Server is a NestJS backend for encrypted social features: auth, follow requests, feed-key sharing, secure feeds, profile stats, privacy controls, moderation, and admin account management.

---

## Authentication

All protected routes require a Bearer token:

```http
Authorization: Bearer <JWT_TOKEN>
```

JWT payload contains:

```json
{
  "sub": "user-uuid",
  "username": "alice"
}
```

### Important auth behavior

- Suspended and banned users are blocked from protected APIs.
- Banned users are also blocked at login.
- Suspended users are blocked at login until `suspendedUntil`.
- If a suspension has already expired, the backend automatically restores the user to `active` on the next authenticated request or login.
- Admin access is checked from the database on each request, not trusted from the token alone.

---

## Setup

- Install dependencies: `npm install`
- Run dev server: `npm run start:dev`
- Build application: `npm run build`
- Run tests: `npm test`

If you are applying these new APIs to an existing database, make sure your Drizzle schema changes are also applied, because new user privacy/admin fields and the `post_reports` table were added.

---

## Common response shapes

### Stats

```json
{
  "followersCount": 12,
  "followingCount": 7,
  "postsCount": 33
}
```

### Security stats

```json
{
  "feedKeySharedWithCount": 8,
  "pendingFollowRequestsCount": 2
}
```

### Reach stats

```json
{
  "potentialAudienceCount": 8,
  "publicPostsCount": 5,
  "followersOnlyPostsCount": 28
}
```

### Privacy settings

```json
{
  "profileVisibility": "public",
  "allowFollowRequests": true
}
```

---

## API Reference

## 1. Auth Module (`/auth`)

### `POST /auth/register`
Create a new user.

#### Body

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

#### Response

```json
{
  "user": {
    "uid": "user-uuid",
    "username": "alice",
    "email": "alice@example.com",
    "encryptedPrivateKey": "...",
    "encryptedFeedKey": "...",
    "publicKey": "...",
    "verified": false,
    "isAdmin": false,
    "accountStatus": "active",
    "suspendedUntil": null,
    "profileVisibility": "public",
    "allowFollowRequests": true,
    "createdAt": "2026-07-04T10:00:00.000Z",
    "updatedAt": "2026-07-04T10:00:00.000Z"
  },
  "stats": {
    "followersCount": 0,
    "followingCount": 0,
    "postsCount": 0
  },
  "securityStats": {
    "feedKeySharedWithCount": 0,
    "pendingFollowRequestsCount": 0
  },
  "reachStats": {
    "potentialAudienceCount": 0,
    "publicPostsCount": 0,
    "followersOnlyPostsCount": 0
  },
  "privacySettings": {
    "profileVisibility": "public",
    "allowFollowRequests": true
  },
  "accessToken": "jwt-token",
  "message": "User created successfully",
  "statusCode": 201
}
```

---

### `POST /auth/login`
Login using username or email.

#### Body

```json
{
  "identifier": "alice",
  "password": "strongpassword"
}
```

#### Success response

```json
{
  "user": {
    "uid": "user-uuid",
    "username": "alice",
    "email": "alice@example.com",
    "encryptedPrivateKey": "...",
    "encryptedFeedKey": "...",
    "publicKey": "...",
    "verified": false,
    "isAdmin": false,
    "accountStatus": "active",
    "suspendedUntil": null,
    "profileVisibility": "public",
    "allowFollowRequests": true,
    "createdAt": "2026-07-04T10:00:00.000Z",
    "updatedAt": "2026-07-04T10:00:00.000Z"
  },
  "stats": {
    "followersCount": 12,
    "followingCount": 7,
    "postsCount": 33
  },
  "securityStats": {
    "feedKeySharedWithCount": 8,
    "pendingFollowRequestsCount": 2
  },
  "reachStats": {
    "potentialAudienceCount": 8,
    "publicPostsCount": 5,
    "followersOnlyPostsCount": 28
  },
  "privacySettings": {
    "profileVisibility": "followers",
    "allowFollowRequests": true
  },
  "accessToken": "jwt-token",
  "message": "Logged in successfully",
  "statusCode": 200
}
```

#### Failure responses

```json
{
  "message": "Invalid username/email or password",
  "statusCode": 401
}
```

```json
{
  "message": "Account is banned",
  "statusCode": 403
}
```

```json
{
  "message": "Account is suspended until 2026-07-10T10:00:00.000Z",
  "statusCode": 403
}
```

---

## 2. User Module (`/user`)

All routes below require a Bearer token.

### `GET /user/profile`
Get the logged-in user's full profile, stats, reach stats, security stats, privacy settings, and all non-deleted posts.

#### Response

```json
{
  "user": {
    "uid": "alice-uuid",
    "username": "alice",
    "email": "alice@example.com",
    "encryptedPrivateKey": "...",
    "encryptedFeedKey": "...",
    "publicKey": "...",
    "verified": false,
    "accountStatus": "active",
    "suspendedUntil": null,
    "profileVisibility": "followers",
    "allowFollowRequests": true,
    "createdAt": "2026-07-04T10:00:00.000Z",
    "updatedAt": "2026-07-04T10:00:00.000Z",
    "isAdmin": false
  },
  "stats": {
    "followersCount": 12,
    "followingCount": 7,
    "postsCount": 33
  },
  "reachStats": {
    "potentialAudienceCount": 8,
    "publicPostsCount": 5,
    "followersOnlyPostsCount": 28
  },
  "securityStats": {
    "feedKeySharedWithCount": 8,
    "pendingFollowRequestsCount": 2
  },
  "privacySettings": {
    "profileVisibility": "followers",
    "allowFollowRequests": true
  },
  "canViewPosts": true,
  "posts": [
    {
      "postId": "post-uuid",
      "uid": "alice-uuid",
      "encryptedContent": "encrypted-text",
      "encryptedMedia": null,
      "replyTo": null,
      "quoteTo": null,
      "visibility": "followers",
      "createdAt": "2026-07-04T10:00:00.000Z",
      "updatedAt": "2026-07-04T10:00:00.000Z",
      "author": {
        "uid": "alice-uuid",
        "username": "alice",
        "name": "Alice",
        "avatar": null,
        "verified": false
      },
      "encryptedFeedKey": "owner-feed-key",
      "likesCount": 4,
      "dislikesCount": 1,
      "repostsCount": 2,
      "repliesCount": 3
    }
  ]
}
```

Notes:
- Own profile posts include `dislikesCount`.
- Deleted posts are excluded.
- For the owner, `encryptedFeedKey` is the owner feed key stored on the user.

---

### `GET /user/profile/:id`
Get another user's profile, stats, reach stats, privacy settings, and visible posts.

#### Response behavior

- If `profileVisibility = "public"`, `canViewPosts` is `true`.
- If `profileVisibility = "followers"`, only accepted followers can see posts.
- If the caller cannot see posts, the API returns `canViewPosts: false` and `posts: []`.
- `securityStats` are not returned for other users.

#### Example response when profile is restricted

```json
{
  "user": {
    "uid": "bob-uuid",
    "username": "bob",
    "email": "bob@example.com",
    "encryptedPrivateKey": "...",
    "encryptedFeedKey": "...",
    "publicKey": "...",
    "verified": false,
    "accountStatus": "active",
    "suspendedUntil": null,
    "profileVisibility": "followers",
    "allowFollowRequests": true,
    "createdAt": "2026-07-04T10:00:00.000Z",
    "updatedAt": "2026-07-04T10:00:00.000Z"
  },
  "stats": {
    "followersCount": 50,
    "followingCount": 10,
    "postsCount": 100
  },
  "reachStats": {
    "potentialAudienceCount": 50,
    "publicPostsCount": 10,
    "followersOnlyPostsCount": 90
  },
  "privacySettings": {
    "profileVisibility": "followers",
    "allowFollowRequests": true
  },
  "canViewPosts": false,
  "posts": []
}
```

---

### `GET /user/stats`
Get the logged-in user's compact stats payload.

#### Response

```json
{
  "user": {
    "uid": "alice-uuid",
    "username": "alice",
    "isAdmin": false,
    "accountStatus": "active",
    "suspendedUntil": null
  },
  "stats": {
    "followersCount": 12,
    "followingCount": 7,
    "postsCount": 33
  },
  "securityStats": {
    "feedKeySharedWithCount": 8,
    "pendingFollowRequestsCount": 2
  },
  "reachStats": {
    "potentialAudienceCount": 8,
    "publicPostsCount": 5,
    "followersOnlyPostsCount": 28
  },
  "privacySettings": {
    "profileVisibility": "followers",
    "allowFollowRequests": true
  }
}
```

---

### `GET /user/stats/:id`
Get a user's public stats summary.

#### Response

```json
{
  "user": {
    "uid": "bob-uuid",
    "username": "bob",
    "accountStatus": "active"
  },
  "stats": {
    "followersCount": 50,
    "followingCount": 10,
    "postsCount": 100
  },
  "reachStats": {
    "potentialAudienceCount": 50,
    "publicPostsCount": 10,
    "followersOnlyPostsCount": 90
  },
  "privacySettings": {
    "profileVisibility": "followers",
    "allowFollowRequests": true
  }
}
```

---

### `PATCH /user/privacy`
Update privacy settings for the logged-in user.

#### Body

```json
{
  "profileVisibility": "followers",
  "allowFollowRequests": true
}
```

Both fields are optional, but at least one must be provided.

#### Response

```json
{
  "message": "Privacy settings updated successfully",
  "privacySettings": {
    "profileVisibility": "followers",
    "allowFollowRequests": true
  }
}
```

---

### `GET /user/all?page=1&limit=20`
Get all users with pagination.

#### Query params

- `page` default: `1`
- `limit` default: `20`
- max `limit`: `100`

#### Response

```json
{
  "data": [
    {
      "uid": "alice-uuid",
      "username": "alice",
      "name": "Alice",
      "avatar": null,
      "bio": "hello",
      "publicKey": "...",
      "verified": false,
      "accountStatus": "active",
      "profileVisibility": "public",
      "allowFollowRequests": true,
      "createdAt": "2026-07-04T10:00:00.000Z",
      "updatedAt": "2026-07-04T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 145,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

This endpoint returns a public user summary. Sensitive fields such as `password`, `isAdmin`, `encryptedPrivateKey`, `encryptedFeedKey`, and `salt` are not included.

---

### `GET /user/:id/followers?page=1&limit=20`
Get all accepted followers for a user with pagination.

#### Query params

- `page` default: `1`
- `limit` default: `20`
- max `limit`: `100`

#### Response

```json
{
  "data": [
    {
      "uid": "follower-uuid",
      "username": "alice",
      "name": "Alice",
      "avatar": null,
      "bio": "hello",
      "publicKey": "...",
      "verified": false,
      "accountStatus": "active",
      "profileVisibility": "public",
      "allowFollowRequests": true,
      "createdAt": "2026-07-04T10:00:00.000Z",
      "updatedAt": "2026-07-04T10:00:00.000Z",
      "followedAt": "2026-07-05T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

Only accepted followers are returned.

---

### `GET /user/:id/following?page=1&limit=20`
Get all accepted followings for a user with pagination.

#### Query params

- `page` default: `1`
- `limit` default: `20`
- max `limit`: `100`

#### Response

```json
{
  "data": [
    {
      "uid": "following-uuid",
      "username": "bob",
      "name": "Bob",
      "avatar": null,
      "bio": "builder",
      "publicKey": "...",
      "verified": false,
      "accountStatus": "active",
      "profileVisibility": "followers",
      "allowFollowRequests": true,
      "createdAt": "2026-07-04T10:00:00.000Z",
      "updatedAt": "2026-07-04T10:00:00.000Z",
      "followedAt": "2026-07-05T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 18,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

Only accepted followings are returned.

---

### `GET /user/follow/pending`
Get follow requests waiting for the logged-in user.

#### Response

```json
[
  {
    "followerId": "alice-uuid",
    "status": "pending",
    "createdAt": "2026-07-04T10:00:00.000Z",
    "username": "alice",
    "name": "Alice Smith",
    "publicKey": "alice-public-key"
  }
]
```

---

### `POST /user/follow/:id`
Send a follow request.

#### Notes

- `:id` is the target user's `uid`.
- If the target user has `allowFollowRequests = false`, this returns `403`.
- If an older request was previously rejected, the relationship is reset to `pending`.

#### Success response

```json
{
  "message": "Follow request sent successfully",
  "follow": {
    "followerId": "alice-uuid",
    "followingId": "bob-uuid",
    "status": "pending",
    "encryptedFeedKey": null,
    "acceptedAt": null,
    "createdAt": "2026-07-04T10:00:00.000Z"
  }
}
```

---

### `POST /user/follow/accept`
Accept a follow request and save the encrypted feed key for that follower.

#### Body

```json
{
  "followerId": "alice-uuid",
  "encryptedFeedKey": "feed-key-encrypted-with-follower-public-key"
}
```

#### Response

```json
{
  "message": "Follow request accepted",
  "follow": {
    "followerId": "alice-uuid",
    "followingId": "bob-uuid",
    "status": "accepted",
    "encryptedFeedKey": "feed-key-encrypted-with-follower-public-key",
    "acceptedAt": "2026-07-04T10:00:00.000Z"
  }
}
```

---

### `POST /user/follow/reject`
Reject a pending follow request.

#### Body

```json
{
  "followerId": "alice-uuid"
}
```

#### Response

```json
{
  "message": "Follow request rejected",
  "follow": {
    "followerId": "alice-uuid",
    "followingId": "bob-uuid",
    "status": "rejected",
    "encryptedFeedKey": null,
    "acceptedAt": null
  }
}
```

---

### `POST /user/follow/revoke`
Revoke feed access for an already accepted follower.

This clears the stored encrypted feed key for that follower and moves the relationship back to `rejected`.

#### Body

```json
{
  "followerId": "alice-uuid"
}
```

#### Response

```json
{
  "message": "Access revoked successfully",
  "follow": {
    "followerId": "alice-uuid",
    "followingId": "bob-uuid",
    "status": "rejected",
    "encryptedFeedKey": null,
    "acceptedAt": null
  }
}
```

---

### `POST /user/unfollow/:id`
Unfollow a user.

#### Response

```json
{
  "message": "Unfollowed successfully"
}
```

---

### `PATCH /user/admin/:id/status`
Admin-only endpoint to change a user's account status.

Protected by:
- `JwtAuthGuard`
- `AdminGuard`

#### Body

```json
{
  "status": "suspended",
  "suspensionDays": 7
}
```

Allowed `status` values:
- `active`
- `suspended`
- `banned`

Rules:
- `suspensionDays` is required when `status = "suspended"`.
- Admins cannot suspend or ban their own admin account.
- One admin cannot manage another admin through this endpoint.

#### Response

```json
{
  "message": "Account status updated successfully",
  "user": {
    "uid": "target-user-uuid",
    "username": "target-user",
    "accountStatus": "suspended",
    "suspendedUntil": "2026-07-11T10:00:00.000Z"
  }
}
```

---

### `DELETE /user/account`
Delete the logged-in user's account.

#### Response

```json
{
  "message": "Account deleted successfully",
  "uid": "alice-uuid"
}
```

---

## 3. Posts Module (`/posts`)

All routes below require a Bearer token.

### `POST /posts`
Create an encrypted post.

#### Body

```json
{
  "encryptedContent": "encrypted-text",
  "encryptedMedia": "encrypted-media-url",
  "replyTo": "parent-post-uuid",
  "quoteTo": "quoted-post-uuid",
  "visibility": "followers"
}
```

#### Response

```json
{
  "postId": "post-uuid",
  "uid": "author-uuid",
  "encryptedContent": "encrypted-text",
  "encryptedMedia": null,
  "replyTo": null,
  "quoteTo": null,
  "visibility": "followers",
  "createdAt": "2026-07-04T10:00:00.000Z",
  "updatedAt": "2026-07-04T10:00:00.000Z",
  "editedAt": null,
  "deletedAt": null
}
```

---

### `GET /posts/feed?page=1&limit=20`
Get the secure feed.

#### Query params

- `page` default: `1`
- `limit` default: `20`

#### Feed behavior

- Followed users with `accepted` status are prioritized.
- A smaller share of non-followed posts is mixed in for discovery.
- Deleted posts are excluded.
- Own replies can still be included so users can see their comment activity.
- Followed posts include `encryptedFeedKey` from the `follows` table.
- Non-followed posts return `encryptedFeedKey: null`.
- Feed results are cached in memory for 10 seconds.

#### Response

```json
[
  {
    "postId": "post-uuid",
    "uid": "bob-uuid",
    "encryptedContent": "encrypted-text",
    "encryptedMedia": null,
    "replyTo": null,
    "quoteTo": null,
    "visibility": "followers",
    "createdAt": "2026-07-04T10:00:00.000Z",
    "updatedAt": "2026-07-04T10:00:00.000Z",
    "author": {
      "uid": "bob-uuid",
      "username": "bob",
      "name": "Bob",
      "avatar": null,
      "verified": false
    },
    "encryptedFeedKey": "feed-key-for-viewer",
    "likesCount": 12,
    "repostsCount": 4,
    "repliesCount": 3
  }
]
```

---

### `POST /posts/:id/like`
Toggle like on a post.

#### Response

```json
{
  "liked": true,
  "message": "Liked successfully"
}
```

or

```json
{
  "liked": false,
  "message": "Unliked successfully"
}
```

---

### `POST /posts/:id/dislike`
Toggle dislike on a post.

#### Response

```json
{
  "disliked": true,
  "message": "Disliked successfully"
}
```

or

```json
{
  "disliked": false,
  "message": "Removed dislike successfully"
}
```

---

### `POST /posts/:id/repost`
Toggle repost on a post.

#### Response

```json
{
  "reposted": true,
  "message": "Reposted successfully"
}
```

or

```json
{
  "reposted": false,
  "message": "Unreposted successfully"
}
```

---

### `POST /posts/:id/report`
Report a post without needing to decrypt it.

This stores moderation metadata only and does not require the server to decrypt content.

#### Body

```json
{
  "reason": "spam",
  "details": "Repeated scam links"
}
```

#### Response

```json
{
  "message": "Post reported successfully",
  "report": {
    "id": "report-uuid",
    "postId": "post-uuid",
    "reporterId": "reporter-uuid",
    "reason": "spam",
    "details": "Repeated scam links",
    "createdAt": "2026-07-04T10:00:00.000Z"
  }
}
```

#### Validation / protection

- The post must exist and not be deleted.
- Users cannot report their own posts.

---

### `GET /posts/:id/replies`
Get replies for a post.

#### Response

```json
[
  {
    "postId": "reply-uuid",
    "uid": "alice-uuid",
    "encryptedContent": "encrypted-reply",
    "encryptedMedia": null,
    "replyTo": "post-uuid",
    "quoteTo": null,
    "visibility": "followers",
    "createdAt": "2026-07-04T10:05:00.000Z",
    "updatedAt": "2026-07-04T10:05:00.000Z",
    "author": {
      "uid": "alice-uuid",
      "username": "alice",
      "name": "Alice",
      "avatar": null,
      "verified": false
    },
    "encryptedFeedKey": "feed-key-if-viewer-follows-author",
    "likesCount": 1,
    "repostsCount": 0,
    "repliesCount": 0
  }
]
```

---

### `POST /posts/:id/comment`
Create an encrypted comment/reply.

#### Body

```json
{
  "encryptedContent": "encrypted-reply",
  "encryptedMedia": "encrypted-media-url"
}
```

#### Response

```json
{
  "postId": "reply-uuid",
  "uid": "author-uuid",
  "encryptedContent": "encrypted-reply",
  "encryptedMedia": null,
  "replyTo": "parent-post-uuid",
  "quoteTo": null,
  "visibility": "followers",
  "createdAt": "2026-07-04T10:05:00.000Z",
  "updatedAt": "2026-07-04T10:05:00.000Z",
  "author": {
    "uid": "author-uuid",
    "username": "alice",
    "name": "Alice",
    "avatar": null,
    "verified": false
  },
  "encryptedFeedKey": null,
  "likesCount": 0,
  "repostsCount": 0,
  "repliesCount": 0
}
```

---

### `DELETE /posts/:id`
Soft-delete a post.

#### Protection

- The post must exist and not already be deleted.
- Only the owner of the post can delete it.
- Deleted posts are hidden```

---

## Privacy and moderation summary

- `profileVisibility` controls whether non-followers can view profile posts.
- `allowFollowRequests` lets a user fully close new follow requests.
- `feedKeySharedWithCount` shows how many accepted followers currently have a shared encrypted feed key.
- `POST /user/follow/revoke` lets a user revoke a follower's access.
- `POST /posts/:id/report` records a moderation report without decrypting content.
- `PATCH /user/admin/:id/status` lets admins activate, suspend, or ban users.
