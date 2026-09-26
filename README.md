# Roomify

A runnable rental-finding web system using HTML, CSS, browser JavaScript, a Node.js HTTP server, and SQLite. The original portfolio is separate from this folder.

## Run locally

Install **Node.js 24 or newer**, then open a terminal inside this folder:

```sh
npm start
```

Open **http://localhost:3001/roomify/** (the root URL also works).

There are no third-party runtime dependencies, so `npm install` is not required. Node may print a warning about the built-in SQLite API; the application uses that API directly.

The database and schema are created automatically at `data/roomify.sqlite`. Start the Node server rather than opening `index.html` directly or using a static Live Server extension; the interface needs the `/api` routes.

## Create your administrator

In another terminal, from this folder:

```sh
npm run admin
```

Enter the admin name, email, and a password of 10–128 characters. The password is hidden while typing. There are **no default passwords**. Log in through the website using that account; the Admin review workspace will appear. The command creates a new admin and refuses to elevate or overwrite an existing account.

For noninteractive setup, the same command reads `ROOMIFY_ADMIN_NAME`, `ROOMIFY_ADMIN_EMAIL`, and `ROOMIFY_ADMIN_PASSWORD` from the environment. Keep these values private and remove them from the environment after setup.

## Optional sample properties

```sh
npm run seed
```

This adds six clearly labeled fictional properties with illustrative Unsplash photos. They cannot accept inquiries. Skip this command if you want an empty system. Running it again refuses to duplicate the sample listings.

## Try the complete workflow

1. Use **Get started** and select **List my property** to create an owner account.
2. In **My listings**, choose **Add a property**. Enter the location, monthly rent, amenities, description, and public contact information. Upload 1–4 JPEG or PNG photos, each up to 3 MB.
3. Submit the property. It stays **pending** and is hidden from renters.
4. Log out and log in as your administrator. Open **Admin review**, inspect the property details/photos, then approve it or reject it with feedback.
5. Create a renter account with **Get started → Find a rental**. Find the approved property, save it, and send an inquiry.
6. Log in as the owner, open **My inquiries**, and send a reply. The renter can read the reply in their own **My inquiries** page.

Use separate browser profiles if you want to keep owner, renter, and admin sessions open simultaneously. Tabs in one browser profile share the same login cookie.

## Included features

- Renter and owner registration, login, and logout.
- Password hashing with scrypt and expiring server-side sessions.
- Location search, property categories, rent and amenity filters, and price sorting.
- Photo gallery, descriptions, owner name, and public contact information.
- Saved properties tied to each account.
- Owner listing creation, editing, availability changes, and deletion.
- Admin approval/rejection with feedback and stale-review protection.
- Edited listings return to pending review automatically.
- In-app renter inquiries and owner replies, visible only to the participants.
- SQLite persistence for accounts, sessions, photos, listings, favorites, and messages.
- Responsive renter, owner, and admin interfaces.

Deleting a property permanently deletes its photos, saved entries, and associated inquiries. The interface asks for confirmation. Unavailable or unapproved properties disappear from public results and saved-property results. Existing messages remain available to their participants until the listing is deleted.

## Configuration

| Variable        | Default               | Purpose                                                                                                        |
| --------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `PORT`          | `3001`                | HTTP server port.                                                                                              |
| `HOST`          | `127.0.0.1`           | Bind address; use `0.0.0.0` only when access from other machines is intended.                                  |
| `ROOMIFY_DB`    | `data/roomify.sqlite` | Database path; relative paths resolve from the terminal's working directory.                                   |
| `PUBLIC_ORIGIN` | Unset                 | Exact public origin, e.g. `https://rentals.example.com`, without a path. Required for non-localhost hostnames. |
| `COOKIE_SECURE` | `0`                   | Set to `1` when serving the application through HTTPS.                                                         |

For hosting, run this as a Node application behind HTTPS. Forward the original public `Host` and `Origin` headers, configure `PUBLIC_ORIGIN` to that origin, and set `COOKIE_SECURE=1`. Route `/api` and the interface to the same Node process. Preserve the SQLite data directory on persistent storage. A static-only host such as GitHub Pages cannot run the server.

Requests from unconfigured hosts and writes from a different origin are rejected. Authentication and writes have process-local rate limits. Deploy a single application process for this version; for multiple instances, use shared storage and distributed rate limiting.

## Data and backups

- Database files under `data/` are ignored by Git and excluded from the source download.
- Stop the server with **Ctrl+C**, then back up the entire `data/` folder. Restore it before restarting the app.
- Do not distribute a populated database: it contains account, session, property, and inquiry data.
- No application data is sent to an email provider. Inquiries and replies are delivered inside Roomify; use **Refresh messages** to see updates.

## Tests

```sh
npm test
```

The integration tests create an isolated temporary SQLite database and an HTTP server on an available port. They verify authentication, role permissions, origin and host checks, hidden pending listings/photos, owner isolation, moderation, stale edits/reviews, favorites, private inquiries/replies, restart persistence, logout invalidation, availability, deletion, and sample-listing restrictions. Test fixtures are removed afterward; your normal database is not used.

## Source files

```text
roomify/
├── index.html              # Page structure and navigation
├── style.css               # Responsive UI and dashboards
├── script.js               # Browser interaction and API integration
├── server.js               # HTTP routes and request protections
├── manage.js               # Admin creation and optional sample data
├── package.json            # Start, admin, seed, and test commands
├── lib/
│   ├── database.js         # SQLite schema and queries
│   ├── security.js         # Validation, password hashing, sessions, limits
│   ├── listings.js         # Listing and photo validation/transactions
│   └── demo.json           # Fictional sample listing descriptions
└── test/system.test.js     # Integration tests
```

## Scope

This is a working local MVP. Email verification, forgotten-password recovery, email/SMS notifications, maps, payments, booking contracts, user suspension, and abuse-report workflows are not included. The admin workspace manages listing moderation. Photos are checked for allowed format signatures and size; image processing and virus scanning are not included. Google Fonts and optional Unsplash example photos require an internet connection; uploaded property photos are stored locally in SQLite.
