import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
    uid: uuid("uid").primaryKey().defaultRandom(),
    name: text("name"),
    username: text("username").notNull().unique(),
    email: text("email").notNull().unique(),
    password: text("password").notNull(),
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    encryptedFeedKey: text("encrypted_feed_key").notNull(),
    salt: text("salt").notNull(),
    publicKey: text("public_key").notNull(),
});
