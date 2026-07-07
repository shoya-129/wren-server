# User Count API Documentation

This document describes the API endpoints available in `wren-server` for querying the total user count. It includes a standard HTTP GET endpoint and a real-time Server-Sent Events (SSE) live count endpoint.

> [!NOTE]
> Both endpoints are fully public (do not require JWT authorization) and support Cross-Origin Resource Sharing (CORS) from any origin (`*`).

---

## 1. Get Static User Count

Retrieves the current total number of registered users in the system.

- **URL:** `/user/count`
- **Method:** `GET`
- **Auth Required:** No (Public Endpoint)
- **Headers:** 
  - `Accept: application/json`

### Response

- **Status Code:** `200 OK`
- **Content Type:** `application/json`

#### Example Response Body:
```json
{
  "count": 42
}
```

---

## 2. Get Live User Count (SSE Stream)

Establishes a persistent Server-Sent Events (SSE) connection to receive real-time updates of the user count. The server streams a new count payload whenever a user registers or deletes their account.

- **URL:** `/user/count/live`
- **Method:** `GET`
- **Auth Required:** No (Public Endpoint)
- **Headers:**
  - `Accept: text/event-stream`
  - `Cache-Control: no-cache`
  - `Connection: keep-alive`

### Stream Payload format

Each event sent from the server contains a JSON string in the `data` field.

#### Example Event Payload:
```text
data: {"count":42}
```

---

## Client Integration Examples

### JavaScript (Browser)

You can consume the live endpoint using the browser's native `EventSource` API:

```javascript
// Establish SSE connection
const eventSource = new EventSource('http://localhost:3000/user/count/live');

// Listen for updates
eventSource.onmessage = (event) => {
  try {
    const payload = JSON.parse(event.data);
    console.log('Real-time User Count:', payload.count);
    
    // Update your DOM/UI element here
    document.getElementById('user-count').innerText = payload.count;
  } catch (error) {
    console.error('Failed to parse SSE payload:', error);
  }
};

// Handle errors and reconnections
eventSource.onerror = (error) => {
  console.error('SSE Error or Disconnection:', error);
};

// To close the connection when no longer needed
// eventSource.close();
```

### React Hook Example

Here is a ready-to-use custom React hook to fetch the live user count:

```typescript
import { useState, useEffect } from 'react';

export function useLiveUserCount(serverUrl: string = 'http://localhost:3000') {
  const [count, setCount] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    const eventSource = new EventSource(`${serverUrl}/user/count/live`);

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && typeof data.count === 'number') {
          setCount(data.count);
        }
      } catch (error) {
        console.error('Failed to parse user count event payload:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      setIsConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [serverUrl]);

  return { count, isConnected };
}
```
