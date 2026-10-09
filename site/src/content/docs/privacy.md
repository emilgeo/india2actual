---
title: Privacy
description: What the india2actual command line tool, browser pages and Chrome extension do with your data. In short, nothing leaves your computer except what you send to your own Actual server.
---

india2actual reads bank and credit card statements, which are private. This page
says exactly what each part does with them.

## In short

- Your statements are read on your own computer. They are never uploaded to us
  or to anyone else.
- There is no account, no analytics, no tracking and no advertising.
- The only network traffic is to **your own Actual server**, and only when you
  choose to push into it.

## The command line tool

It runs on your computer. It reads the statement file you name and writes a file
next to it. With `--push` it connects to the Actual server you configure, using
the settings in your `.env` file or environment. Nothing is sent anywhere else.

## The Convert page and the downloadable file

The Convert page and `india2actual.html` read a statement inside the browser
tab. The Convert page carries a security policy that forbids every network
request, so it cannot send your statement anywhere, even by mistake. The
downloadable file may reach an `https` server or one on your own computer, and
nothing else.

What they keep in your browser, on your computer only:

- Names you give payees, so the next statement uses them. You can clear them
  from the page.
- If you tick the box, your server address and Sync ID. Never a password.
- Which Actual account each statement account goes to.

Passwords you type, for a PDF or for Actual, stay in the page and are gone when
you close it.

## The Chrome extension

It is the same page, shown in the browser's side panel. It asks for:

- **Side panel**, to show the panel.
- **Access to `localhost`**, so it can see which Actual account is open when
  your Actual server runs on your own computer.
- **Optional access to a website you name**, asked for once when you connect,
  so it can see which Actual account is open in your Actual tab. It reads only
  the address of that tab, and only to preselect the account. It never reads
  the page's contents, and you can refuse and still use the panel.

If you tick Stay connected on this device, it keeps a sign-in token for your
Actual server, your server address and your Sync ID in its own storage, on your
computer only, so you do not have to type the password each time. It never keeps
the password itself or a budget's encryption password. The token is the kind
Actual's own app uses, and anyone with access to your browser profile could use
it until the server stops accepting it. Forget saved sign-in deletes it, and unticking the box and
connecting again does too. The downloadable page never keeps a sign-in.

It does not collect, store or transmit anything about your browsing.

## Your Actual server

When you push, the page talks to your Actual server in the same way Actual's own
app does, so the server receives the transactions you chose to import. That
server is yours; this project never sees it.

## Questions

Open an issue on the project's GitHub page.
