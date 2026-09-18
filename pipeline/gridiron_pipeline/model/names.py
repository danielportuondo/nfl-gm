"""Name lists for procedurally generated players.

Common US census-style given names and surnames, pruned so that **no** first/last combination the
generator can produce matches any player in the nflverse players master. Real people do not end up
in a generated draft class.
"""

from __future__ import annotations

import re
import unicodedata

from gridiron_pipeline.model.data import load_players

MIN_NAMES = 50

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

# fmt: off
FIRST_CANDIDATES: tuple[str, ...] = (
    "James", "Robert", "John", "Michael", "David", "William", "Richard", "Joseph", "Thomas",
    "Charles", "Christopher", "Daniel", "Matthew", "Anthony", "Mark", "Donald", "Steven", "Paul",
    "Andrew", "Joshua", "Kenneth", "Kevin", "Brian", "George", "Timothy", "Ronald", "Jason",
    "Edward", "Jeffrey", "Ryan", "Jacob", "Gary", "Nicholas", "Eric", "Jonathan", "Stephen",
    "Larry", "Justin", "Scott", "Brandon", "Benjamin", "Samuel", "Gregory", "Alexander", "Patrick",
    "Frank", "Raymond", "Jack", "Dennis", "Jerry", "Tyler", "Aaron", "Adam", "Nathan", "Henry",
    "Zachary", "Douglas", "Peter", "Kyle", "Noah", "Ethan", "Jeremy", "Walter", "Christian",
    "Keith", "Roger", "Terry", "Austin", "Sean", "Gerald", "Carl", "Harold", "Dylan", "Arthur",
    "Lawrence", "Jordan", "Jesse", "Bryan", "Bruce", "Gabriel", "Logan", "Alan", "Albert", "Elijah",
    "Wayne", "Randy", "Vincent", "Mason", "Roy", "Ralph", "Russell", "Bradley", "Philip", "Eugene",
    "Louis", "Caleb", "Isaac", "Luke", "Owen", "Hunter", "Levi", "Wyatt", "Grayson", "Julian",
    "Ezra", "Miles", "Silas", "Micah", "Rowan", "Desmond", "Quentin", "Marcus", "Darius",
    "Terrence", "Andre", "Emmanuel", "Xavier", "Damon", "Devin", "Trevor", "Colton", "Preston",
    "Bennett", "Graham", "Nolan", "Spencer", "Weston", "Barrett", "Sawyer", "Emmett", "Declan",
    "Everett", "Ronan", "Tobias", "Simon", "Oscar", "Felix", "Hugo", "Ivan", "Omar", "Rafael",
    "Diego", "Mateo", "Santiago", "Adrian", "Damian", "Cesar", "Manuel", "Enrique", "Leonard",
    "Clarence", "Alfred", "Norman", "Milton", "Edgar", "Ernest", "Herbert", "Warren", "Byron",
    "Dale", "Glenn", "Neil", "Stuart", "Vernon", "Wallace",
)
# fmt: on

# fmt: off
LAST_CANDIDATES: tuple[str, ...] = (
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez",
    "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Taylor", "Moore",
    "Jackson", "Martin", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez",
    "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Torres", "Hill", "Flores",
    "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter",
    "Roberts", "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker", "Cruz", "Edwards",
    "Collins", "Reyes", "Stewart", "Morris", "Morales", "Murphy", "Cook", "Rogers", "Gutierrez",
    "Ortiz", "Morgan", "Cooper", "Peterson", "Bailey", "Reed", "Kelly", "Howard", "Ramos", "Cox",
    "Ward", "Richardson", "Watson", "Brooks", "Chavez", "Wood", "Bennett", "Gray", "Mendoza",
    "Ruiz", "Hughes", "Price", "Alvarez", "Castillo", "Sanders", "Myers", "Long", "Ross", "Foster",
    "Jimenez", "Powell", "Jenkins", "Perry", "Russell", "Sullivan", "Bell", "Coleman", "Butler",
    "Henderson", "Barnes", "Gonzales", "Fisher", "Vasquez", "Simmons", "Romero", "Patterson",
    "Hamilton", "Graham", "Reynolds", "Griffin", "Wallace", "Moreno", "West", "Cole", "Hayes",
    "Bryant", "Herrera", "Gibson", "Ellis", "Medina", "Aguilar", "Stevens", "Murray", "Ford",
    "Castro", "Marshall", "Owens", "Harrison", "Fernandez", "Woods", "Kennedy", "Wells", "Vargas",
    "Freeman", "Webb", "Tucker", "Guzman", "Burns", "Crawford", "Olson", "Simpson", "Porter",
    "Gordon", "Mendez", "Silva", "Shaw", "Snyder", "Dixon", "Munoz", "Hunt", "Hicks", "Holmes",
    "Palmer", "Wagner", "Black", "Robertson", "Boyd", "Rose", "Stone", "Salazar", "Fox", "Warren",
    "Mills", "Meyer", "Rice", "Schmidt", "Garza", "Daniels", "Ferguson", "Nichols", "Stephens",
    "Soto", "Weaver", "Gardner", "Payne", "Grant", "Dunn", "Kelley", "Hawkins", "Arnold", "Pierce",
    "Vazquez", "Hansen", "Peters", "Santos", "Hart", "Bradley", "Knight", "Elliott", "Cunningham",
    "Duncan", "Armstrong", "Hudson", "Carroll", "Lane", "Riley", "Andrews", "Alvarado", "Delgado",
    "Berry", "Perkins", "Hoffman", "Johnston", "Matthews", "Pena", "Richards", "Contreras",
    "Willis", "Carpenter", "Lawrence", "Sandoval", "Guerrero", "Chapman", "Rios", "Estrada",
    "Ortega", "Watkins", "Greene", "Nunez", "Wheeler", "Valdez", "Harper", "Burke", "Larson",
    "Maldonado", "Morrison", "Franklin", "Carlson", "Dominguez", "Carr", "Lawson", "Jacobs",
    "Lynch", "Vega", "Bishop", "Montgomery", "Oliver", "Jensen", "Harvey", "Williamson", "Gilbert",
    "Dean", "Sims", "Espinoza", "Howell", "Reid", "Hanson", "Garrett", "Burton", "Fuller", "Weber",
    "Welch", "Rojas", "Lucas", "Marquez", "Fields", "Little", "Banks", "Padilla", "Walsh", "Bowman",
    "Schultz", "Luna", "Fowler", "Mejia", "Barker", "Bauer", "Beck", "Blair", "Bond", "Bowen",
    "Boyle", "Brady", "Brennan", "Bridges", "Buchanan", "Burgess", "Cannon", "Cardenas", "Casey",
    "Chandler", "Christensen", "Clayton", "Clements", "Colon", "Combs", "Conley", "Conner",
    "Cortez", "Craig", "Crane", "Curry", "Dalton", "Davenport", "Dawson", "Decker", "Dennis",
    "Donovan", "Dorsey", "Doyle", "Drake", "Dudley", "Durham", "Eaton", "Emerson", "Farmer",
    "Farrell", "Finley", "Fitzgerald", "Fleming", "Fletcher", "Flynn", "Frazier", "French", "Frost",
    "Gallagher", "Gallegos", "Gibbs", "Glover", "Goodman", "Goodwin", "Gould", "Hale", "Hammond",
    "Hardy", "Harmon", "Hatfield", "Hayden", "Hebert", "Hendricks", "Hester", "Hinton", "Hobbs",
    "Hogan", "Holland", "Hollis", "Horton", "Houston", "Huff", "Ingram", "Irwin", "Jarvis",
    "Jennings", "Joyce", "Keller", "Kemp", "Kerr", "Kirby", "Kline", "Lambert", "Landry", "Langley",
    "Larsen", "Leach", "Leblanc", "Leonard", "Lindsey", "Livingston", "Lombardi", "Lowery", "Lyons",
    "Macias", "Mack", "Madden", "Mahoney", "Malone", "Mann", "Manning", "Marsh",
)
# fmt: on


def _normalize(name: object) -> str:
    if not isinstance(name, str):
        return ""
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z ]", " ", text.lower())
    tokens = [t for t in text.split() if t and t not in _SUFFIXES]
    if len(tokens) < 2:
        return ""
    return f"{tokens[0]} {tokens[-1]}"


def real_full_names() -> set[str]:
    players = load_players()
    names = {_normalize(n) for n in players["display_name"]}
    combined = (
        players["first_name"].astype("string").fillna("")
        + " "
        + players["last_name"].astype("string").fillna("")
    )
    names |= {_normalize(n) for n in combined}
    names.discard("")
    return names


def generate_name_lists() -> dict[str, list[str]]:
    """Largest collision-free first x last grid we can carve out of the candidate pools."""
    taken = real_full_names()
    firsts = list(FIRST_CANDIDATES)
    lasts = list(LAST_CANDIDATES)

    conflicts = {
        (first, last)
        for first in firsts
        for last in lasts
        if f"{first.lower()} {last.lower()}" in taken
    }
    while conflicts:
        by_first: dict[str, int] = {}
        by_last: dict[str, int] = {}
        for first, last in conflicts:
            by_first[first] = by_first.get(first, 0) + 1
            by_last[last] = by_last.get(last, 0) + 1
        worst_first = max(sorted(by_first), key=lambda k: (by_first[k], k))
        worst_last = max(sorted(by_last), key=lambda k: (by_last[k], k))
        drop_first = by_first[worst_first] >= by_last[worst_last] and len(firsts) > MIN_NAMES
        if drop_first:
            firsts.remove(worst_first)
            conflicts = {c for c in conflicts if c[0] != worst_first}
        else:
            lasts.remove(worst_last)
            conflicts = {c for c in conflicts if c[1] != worst_last}

    if len(firsts) < MIN_NAMES or len(lasts) < MIN_NAMES:
        raise RuntimeError(
            f"name pools exhausted: {len(firsts)} first / {len(lasts)} last after pruning"
        )
    return {"first": sorted(firsts), "last": sorted(lasts)}
