```mermaid
sequenceDiagram
    participant web as Web Browser
    participant blog as Blog Service
    participant account as Account Service
    participant mail as Mail Service
    participant db as Storage
    web->>account: Logs in using credentials
    account->>db: Query stored accounts
    db->>account: Respond with query result
    account->>web: Successfully logged in
    Note over web,db: The user must be logged in to submit blog posts
```
