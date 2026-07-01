import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
    // Identity
    uid: uuid("uid").primaryKey().defaultRandom(),
    username: text("username").notNull().unique(),
    email: text("email").notNull().unique(),
    name: text("name"),

    // Profile
    avatar: text("avatar"),
    bio: text("bio"),

    // Authentication
    password: text("password").notNull(),

    // Encryption
    publicKey: text("public_key").notNull(),
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    encryptedFeedKey: text("encrypted_feed_key").notNull(),
    salt: text("salt").notNull(),

    // Status
    verified: boolean("verified").default(false),
    accountStatus: text("account_status")
        .$type<"active" | "suspended" | "banned">()
        .default("active")
        .notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export const profileLinks = pgTable("profile_links", {
    id: uuid("id").primaryKey().defaultRandom(),

    uid: uuid("uid")
        .references(() => users.uid, { onDelete: "cascade" })
        .notNull(),

    platform: text("platform").notNull(), // github, x, instagram, youtube

    url: text("url").notNull(),
});

export const follows = pgTable("follows", {
    followerId: uuid("follower_id")
        .references(() => users.uid, { onDelete: "cascade" })
        .notNull(),

    followingId: uuid("following_id")
        .references(() => users.uid, { onDelete: "cascade" })
        .notNull(),

    status: text("status")
        .$type<"pending" | "accepted" | "rejected" | "blocked">()
        .default("pending")
        .notNull(),

    encryptedFeedKey: text("encrypted_feed_key"),

    acceptedAt: timestamp("accepted_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posts = pgTable("posts", {
    postId: uuid("post_id").primaryKey().defaultRandom(),

    uid: uuid("uid")
        .references(() => users.uid, { onDelete: "cascade" })
        .notNull(),

    encryptedContent: text("encrypted_content").notNull(),

    encryptedMedia: text("encrypted_media"),

    replyTo: uuid("reply_to"),
    quoteTo: uuid("quote_to"),

    visibility: text("visibility").default("followers").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),

    editedAt: timestamp("edited_at"),
    deletedAt: timestamp("deleted_at"),
});

export const likes = pgTable("likes", {
    postId: uuid("post_id")
        .references(() => posts.postId, { onDelete: "cascade" })
        .notNull(),

    uid: uuid("uid")
        .references(() => users.uid, { onDelete: "cascade" })
        .notNull(),

    createdAt: timestamp("created_at").defaultNow(),
});

export const dislikes = pgTable("dislikes", {
    postId: uuid("post_id")
        .references(() => posts.postId, { onDelete: "cascade" })
        .notNull(),

    uid: uuid("uid")
        .references(() => users.uid, { onDelete: "cascade" })
        .notNull(),

    createdAt: timestamp("created_at").defaultNow(),
});

export const reposts = pgTable("reposts", {
    postId: uuid("post_id")
        .references(() => posts.postId, { onDelete: "cascade" })
        .notNull(),

    uid: uuid("uid")
        .references(() => users.uid, { onDelete: "cascade" })
        .notNull(),

    createdAt: timestamp("created_at").defaultNow(),
});

export const bookmarks = pgTable("bookmarks", {
    postId: uuid("post_id")
        .references(() => posts.postId, { onDelete: "cascade" })
        .notNull(),

    uid: uuid("uid")
        .references(() => users.uid, { onDelete: "cascade" })
        .notNull(),

    createdAt: timestamp("created_at").defaultNow(),
});
