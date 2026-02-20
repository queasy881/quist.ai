CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(32) UNIQUE NOT NULL,
    display_name VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_color VARCHAR(7) DEFAULT '#5865F2',
    status VARCHAR(20) DEFAULT 'online',
    custom_status VARCHAR(128) DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Friend requests & friendships
CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_id UUID REFERENCES users(id) ON DELETE CASCADE,
    addressee_id UUID REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(requester_id, addressee_id)
);

-- DM conversations (between 2 users)
CREATE TABLE IF NOT EXISTS dm_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user1_id UUID REFERENCES users(id) ON DELETE CASCADE,
    user2_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user1_id, user2_id)
);

-- Servers
CREATE TABLE IF NOT EXISTS servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    icon_color VARCHAR(7) DEFAULT '#5865F2',
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    invite_code VARCHAR(8) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Server members
CREATE TABLE IF NOT EXISTS server_members (
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (server_id, user_id)
);

-- Channels (belong to a server)
CREATE TABLE IF NOT EXISTS channels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    topic VARCHAR(256) DEFAULT '',
    channel_type VARCHAR(20) DEFAULT 'text',
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Messages (for both channels and DMs)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
    dm_conversation_id UUID REFERENCES dm_conversations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    edited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    CHECK (
        (channel_id IS NOT NULL AND dm_conversation_id IS NULL) OR
        (channel_id IS NULL AND dm_conversation_id IS NOT NULL)
    )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_dm ON messages(dm_conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id, position);
CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships(requester_id, addressee_id);
CREATE INDEX IF NOT EXISTS idx_dm_users ON dm_conversations(user1_id, user2_id);
