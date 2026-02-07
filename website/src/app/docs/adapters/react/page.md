---
title: React Adapter
description: Integrate Directive with React using hooks for reactive state management. DirectiveProvider, useFacts, useDerive, and more.
---

Directive provides first-class React integration with hooks that automatically re-render on state changes. {% .lead %}

---

## Installation

The React adapter is included in the main package:

```typescript
import { DirectiveProvider, useFacts, useDerive } from 'directive/react';
```

---

## Setup

Wrap your app with `DirectiveProvider`:

```tsx
import { createSystem } from 'directive';
import { DirectiveProvider } from 'directive/react';
import { userModule } from './modules/user';

const system = createSystem({ module: userModule });

function App() {
  return (
    <DirectiveProvider system={system}>
      <YourApp />
    </DirectiveProvider>
  );
}
```

---

## Hooks

### useFacts

Read and write facts:

```tsx
function UserProfile() {
  const facts = useFacts();
  const setFacts = useFacts.set();

  return (
    <div>
      <input
        value={facts.userId}
        onChange={(e) => setFacts({ userId: parseInt(e.target.value) })}
      />
      <p>User: {facts.user?.name}</p>
    </div>
  );
}
```

#### Selecting Specific Facts

For better performance, select only what you need:

```tsx
function UserName() {
  const user = useFacts((facts) => facts.user);

  return <span>{user?.name}</span>;
}
```

#### Equality Function

Customize re-render behavior:

```tsx
const user = useFacts(
  (facts) => facts.user,
  (prev, next) => prev?.id === next?.id // Only re-render if ID changes
);
```

### useDerive

Read derivations:

```tsx
function Greeting() {
  const derive = useDerive();

  return <h1>Hello, {derive.displayName}!</h1>;
}
```

#### Selecting Derivations

```tsx
function Status() {
  const isLoggedIn = useDerive((derive) => derive.isLoggedIn);

  return <span>{isLoggedIn ? 'Logged in' : 'Guest'}</span>;
}
```

### useSystem

Access the full system:

```tsx
function DebugPanel() {
  const system = useSystem();

  const handleReset = () => system.reset();
  const handleSnapshot = () => console.log(system.snapshot());

  return (
    <div>
      <button onClick={handleReset}>Reset</button>
      <button onClick={handleSnapshot}>Snapshot</button>
    </div>
  );
}
```

### useSettle

Wait for async resolution:

```tsx
function SaveButton() {
  const setFacts = useFacts.set();
  const settle = useSettle();
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setFacts({ saveRequested: true });
    await settle();
    setSaving(false);
  };

  return (
    <button onClick={handleSave} disabled={saving}>
      {saving ? 'Saving...' : 'Save'}
    </button>
  );
}
```

### useEvents

Listen to events:

```tsx
function Notifications() {
  const [messages, setMessages] = useState<string[]>([]);

  useEvents('USER_LOGGED_IN', (event) => {
    setMessages((m) => [...m, `User ${event.payload.userId} logged in`]);
  });

  return (
    <ul>
      {messages.map((msg, i) => (
        <li key={i}>{msg}</li>
      ))}
    </ul>
  );
}
```

---

## Typed Hooks

Create typed hooks for your module:

```tsx
import { createTypedHooks } from 'directive/react';
import { userModule } from './modules/user';

export const {
  useFacts,
  useDerive,
  useSystem,
  useSettle,
  useEvents,
} = createTypedHooks<typeof userModule>();
```

Now hooks are fully typed:

```tsx
function Profile() {
  const facts = useFacts();
  facts.userId; // number
  facts.user;   // User | null
  facts.typo;   // TypeScript error!
}
```

---

## Patterns

### Loading States

```tsx
function UserCard() {
  const { loading, error, user } = useFacts();

  if (loading) return <Spinner />;
  if (error) return <Error message={error} />;
  if (!user) return <EmptyState />;

  return <UserDetails user={user} />;
}
```

### Optimistic Updates

```tsx
function LikeButton({ postId }: { postId: string }) {
  const liked = useFacts((f) => f.likedPosts.includes(postId));
  const setFacts = useFacts.set();

  const handleLike = () => {
    // Optimistic update
    setFacts((prev) => ({
      likedPosts: liked
        ? prev.likedPosts.filter((id) => id !== postId)
        : [...prev.likedPosts, postId],
    }));
    // Resolver handles API call and rollback on failure
  };

  return (
    <button onClick={handleLike}>
      {liked ? 'Unlike' : 'Like'}
    </button>
  );
}
```

### Form Binding

```tsx
function ProfileForm() {
  const { profile } = useFacts();
  const setFacts = useFacts.set();

  const handleChange = (field: string) => (e: ChangeEvent<HTMLInputElement>) => {
    setFacts({
      profile: { ...profile, [field]: e.target.value },
    });
  };

  return (
    <form>
      <input value={profile?.name ?? ''} onChange={handleChange('name')} />
      <input value={profile?.email ?? ''} onChange={handleChange('email')} />
    </form>
  );
}
```

### Multi-Module Access

```tsx
// With namespaced modules
const system = createSystem({
  modules: {
    user: userModule,
    cart: cartModule,
  },
});

function CartWithUser() {
  const userName = useFacts((f) => f.user.name);
  const cartTotal = useDerive((d) => d.cart.total);

  return (
    <div>
      <p>{userName}'s Cart</p>
      <p>Total: ${cartTotal}</p>
    </div>
  );
}
```

---

## Performance

### Avoid Over-Selecting

```tsx
// Bad - re-renders on any fact change
function UserName() {
  const facts = useFacts();
  return <span>{facts.user?.name}</span>;
}

// Good - only re-renders when user changes
function UserName() {
  const user = useFacts((f) => f.user);
  return <span>{user?.name}</span>;
}

// Best - only re-renders when name changes
function UserName() {
  const name = useFacts((f) => f.user?.name);
  return <span>{name}</span>;
}
```

### Memoize Selectors

```tsx
const selectUserNames = (facts) => facts.users.map((u) => u.name);

// Selector runs on every render, creates new array
function UserList() {
  const names = useFacts(selectUserNames);
  return <ul>{names.map((n) => <li key={n}>{n}</li>)}</ul>;
}

// Use useMemo for derived computations in components
function UserList() {
  const users = useFacts((f) => f.users);
  const names = useMemo(() => users.map((u) => u.name), [users]);
  return <ul>{names.map((n) => <li key={n}>{n}</li>)}</ul>;
}
```

---

## Server Components

For React Server Components, read initial state on the server:

```tsx
// app/page.tsx (Server Component)
import { createSystem } from 'directive';
import { userModule } from './modules/user';
import { ClientApp } from './ClientApp';

export default async function Page() {
  const system = createSystem({ module: userModule });

  // Server-side data fetching
  system.facts.userId = getUserIdFromSession();
  await system.settle();

  const initialState = system.snapshot();

  return <ClientApp initialState={initialState} />;
}

// ClientApp.tsx
'use client';

export function ClientApp({ initialState }) {
  const system = useMemo(() => {
    const s = createSystem({ module: userModule });
    s.restore(initialState);
    return s;
  }, []);

  return (
    <DirectiveProvider system={system}>
      <App />
    </DirectiveProvider>
  );
}
```

---

## Testing

```tsx
import { render, screen } from '@testing-library/react';
import { createTestSystem } from 'directive/testing';
import { DirectiveProvider } from 'directive/react';
import { userModule } from './modules/user';
import { UserProfile } from './UserProfile';

test('displays user name', async () => {
  const system = createTestSystem({ module: userModule });
  system.facts.user = { id: 1, name: 'Test User' };

  render(
    <DirectiveProvider system={system}>
      <UserProfile />
    </DirectiveProvider>
  );

  expect(screen.getByText('Test User')).toBeInTheDocument();
});
```

---

## Next Steps

- **[Quick Start](/docs/quick-start)** - Build your first module
- **[Facts](/docs/facts)** - State management deep dive
- **[Testing](/docs/testing/overview)** - Testing React components
