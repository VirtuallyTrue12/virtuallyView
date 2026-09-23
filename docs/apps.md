# Other apps (Immich, Audiobookshelf, Kavita)

Apps in the nav (under More) links to self-hosted apps you already run and
shows whether each is answering. Nothing is bundled or installed for you, and
each app keeps its own interface: virtuallyView opens it in a new tab.

Enter the app's address (for example `http://192.168.1.5:2283` for Immich).
Only an administrator can change this.

| App | What | Optional key | Headline shown with a key |
| --- | --- | --- | --- |
| [Immich](https://immich.app) | Photos and videos with search | API key: Account Settings > API Keys | photo and video counts |
| [Audiobookshelf](https://www.audiobookshelf.org) | Audiobooks and podcasts | API token: Settings > Users | library count |
| [Kavita](https://www.kavitareader.com) | Ebooks, manga and comics | none | health only |

Keys are stored on the server and never sent back to the browser.

This is a link-and-health integration, not a deep one: it does not browse
those libraries inside virtuallyView.
