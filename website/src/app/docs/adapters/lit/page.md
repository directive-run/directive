---
title: Lit Adapter
description: Use Directive with Lit web components using reactive controllers.
---

Integrate Directive with Lit using reactive controllers. {% .lead %}

---

## Installation

```bash
npm install directive directive/lit
```

---

## Basic Setup

Create a reactive controller for your system:

```typescript
import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { DirectiveController } from 'directive/lit';
import { system } from './system';

@customElement('my-counter')
class MyCounter extends LitElement {
  private directive = new DirectiveController(this, system);

  render() {
    const count = this.directive.facts.count;

    return html`
      <div>
        <p>Count: ${count}</p>
        <button @click=${this.decrement}>-</button>
        <button @click=${this.increment}>+</button>
      </div>
    `;
  }

  private increment() {
    this.directive.facts.count++;
  }

  private decrement() {
    this.directive.facts.count--;
  }
}
```

---

## Watching Facts

Subscribe to specific facts:

```typescript
class UserProfile extends LitElement {
  private directive = new DirectiveController(this, system, {
    watch: ['user', 'loading'],
  });

  render() {
    const { user, loading } = this.directive.facts;

    if (loading) return html`<p>Loading...</p>`;
    if (!user) return html`<p>No user</p>`;

    return html`<p>Welcome, ${user.name}</p>`;
  }
}
```

---

## Using Derivations

Access computed values:

```typescript
class CartSummary extends LitElement {
  private directive = new DirectiveController(this, system);

  render() {
    const total = this.directive.derive.cartTotal;
    const count = this.directive.derive.itemCount;

    return html`
      <div>
        <p>Items: ${count}</p>
        <p>Total: $${total.toFixed(2)}</p>
      </div>
    `;
  }
}
```

---

## Event Handling

Listen for Directive events:

```typescript
class NotificationHandler extends LitElement {
  private directive = new DirectiveController(this, system);

  connectedCallback() {
    super.connectedCallback();
    this.directive.on('ORDER_PLACED', this.handleOrder.bind(this));
  }

  private handleOrder(payload: { orderId: string }) {
    this.showNotification(`Order ${payload.orderId} placed!`);
  }
}
```

---

## Multiple Systems

Use multiple controllers for different systems:

```typescript
class Dashboard extends LitElement {
  private auth = new DirectiveController(this, authSystem);
  private cart = new DirectiveController(this, cartSystem);

  render() {
    return html`
      <user-info .user=${this.auth.facts.user}></user-info>
      <cart-summary .items=${this.cart.facts.items}></cart-summary>
    `;
  }
}
```

---

## Next Steps

- See React Adapter for React integration
- See Vue Adapter for Vue integration
- See Module and System for system setup
