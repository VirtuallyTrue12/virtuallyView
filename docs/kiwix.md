# Wiki (Kiwix)

[Kiwix](https://www.kiwix.org) (open source) reads ZIM files: full offline copies of Wikipedia, Wiktionary, medical references, repair guides and hundreds of other sites, with no internet needed once downloaded. The Wiki page (under More) embeds Kiwix's own reader, which already has search and browsing.

## Bundled server

```
docker compose --profile kiwix up -d
```

It downloads the libraries listed in `KIWIX_ZIMS` (a small starter set by default: Wikipedia intro articles, wikibooks, travel, appropedia, medicine and water guides), serves them, and adds each new one as it finishes. Downloads resume after a restart. The Wiki page connects to it by itself. Check progress with `docker compose logs -f kiwix`.

Already run a Kiwix server elsewhere? Enter its address on the Wiki page instead.

## Choosing libraries

`KIWIX_ZIMS` in `.env` is a space-separated list of `folder/name-prefix`; the newest version is picked. Sizes below are approximate.

| Pack | Entries | Size |
| --- | --- | --- |
| Starter (default) | `wikipedia/wikipedia_en_all_mini wikibooks/wikibooks_en_all_nopic wikivoyage/wikivoyage_en_all_maxi other/appropedia_en_all_maxi other/zimgit-medicine_en other/zimgit-water_en` | ~18 GB |
| Full English Wikipedia with images | `wikipedia/wikipedia_en_all_maxi` (replaces mini) | ~119 GB |
| Wikipedia without images | `wikipedia/wikipedia_en_all_nopic` | ~49 GB |
| Medicine | `other/mdwiki_en_all_maxi wikipedia/wikipedia_en_medicine_maxi other/wikem_en_all_maxi` | ~4.5 GB |
| Survival and how-to | `other/zimgit-post-disaster_en other/zimgit-food-preparation_en other/zimgit-knots_en other/zimgit-water_en other/zimgit-medicine_en other/appropedia_en_all_maxi ifixit/ifixit_en_all` | ~4.5 GB |
| Dictionary | `wiktionary/wiktionary_en_all_nopic` | ~8.5 GB |

Example: `KIWIX_ZIMS="wikipedia/wikipedia_en_all_maxi other/mdwiki_en_all_maxi other/zimgit-post-disaster_en ifixit/ifixit_en_all"`, then `docker compose up -d kiwix`.

Browse everything available at [library.kiwix.org](https://library.kiwix.org) (files live under `download.kiwix.org/zim/<folder>/`). You can also copy any `.zim` file into the `kiwix-data` volume and run `docker compose restart kiwix`.

Dropping a library from the list does not delete it; remove the file from the volume to reclaim the space.

If the dashboard is served over HTTPS, browsers block the embedded (HTTP) reader; open it directly on port 8888 instead.
