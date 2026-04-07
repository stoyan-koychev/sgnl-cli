import re

LANGUAGE_PROFILES = {
    'en': {
        'stop_words': {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
            'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been',
            'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
            'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
            'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our', 'you',
            'your', 'i', 'my', 'he', 'she', 'his', 'her', 'not', 'no', 'so', 'if',
            'about', 'which', 'who', 'what', 'when', 'where', 'how', 'all', 'any',
            'both', 'also', 'just', 'more', 'than', 'then', 'up', 'out', 'into'
        },
        'first_person_pattern': r"\b(I|we|my|our|I've|we've|I'm|we're|I'll|we'll)\b",
        'cta_patterns': [
            'buy now', 'shop now', 'order now', 'add to cart',
            'sign up', 'sign up free', 'sign up now',
            'get started', 'start now', 'start free', 'start trial',
            'free trial', 'try free', 'try it free', 'try for free',
            'contact us', 'get in touch', 'reach out',
            'subscribe', 'subscribe now',
            'download', 'download now', 'download free',
            'request a demo', 'book a demo', 'schedule a demo',
            'claim your', 'get your free', 'get a quote',
            'register now', 'create account', 'join now',
            'learn more', 'find out more', 'discover more',
        ],
        'boilerplate_patterns': [
            'lorem ipsum', 'coming soon', 'under construction',
            'placeholder text', 'sample content',
            'all rights reserved', 'cookie policy',
            'privacy policy', 'terms and conditions'
        ],
        'time_sensitive_words': ['currently', 'right now', 'today', 'latest', 'newest', 'now', 'this year'],
        'citation_patterns': [
            r'according to', r'study by', r'research shows',
            r'source:', r'per a study', r'researchers found',
        ],
        'author_bio_patterns': [
            r'\babout the author\b',
            r'\bauthor bio\b',
            r'\bauthor profile\b',
            r'\bwritten by\b',
            r'\bby [A-Z][a-z]+ [A-Z][a-z]+\b',
            r'\bcontributed by\b',
            r'\bauthored by\b',
        ],
        'transition_words': [
            'however', 'therefore', 'furthermore', 'additionally', 'moreover',
            'consequently', 'nevertheless', 'although', 'meanwhile', 'subsequently',
            'accordingly', 'thus', 'hence', 'otherwise', 'nonetheless',
        ],
        'readability_formula': 'flesch',
    },
    'de': {
        'stop_words': {
            'der', 'die', 'das', 'und', 'oder', 'ist', 'sind', 'war', 'waren',
            'ein', 'eine', 'einem', 'einer', 'eines', 'den', 'dem', 'des',
            'von', 'mit', 'auf', 'in', 'an', 'bei', 'zu', 'als', 'auch',
            'noch', 'aber', 'wenn', 'dann', 'nicht', 'sich', 'es', 'sie',
            'er', 'wir', 'ihr', 'ich', 'du', 'mein', 'meine', 'sein',
            'seine', 'unser', 'unsere', 'dieser', 'diese', 'dieses', 'jede',
            'jeder', 'alle', 'mehr', 'so', 'wie', 'was', 'wo', 'wann', 'wer'
        },
        'first_person_pattern': r'\b(ich|wir|mein|meine|unser|unsere)\b',
        'cta_patterns': ['jetzt kaufen', 'kostenlos testen', 'anmelden', 'jetzt starten'],
        'boilerplate_patterns': ['lorem ipsum', 'demnächst verfügbar', 'im aufbau'],
        'time_sensitive_words': ['aktuell', 'jetzt', 'heute', 'neueste'],
        'citation_patterns': [r'laut', r'studie von', r'forscher zeigen', r'laut forschung'],
        'author_bio_patterns': [r'über den autor', r'geschrieben von', r'autor profil'],
        'transition_words': [
            'jedoch', 'daher', 'außerdem', 'zusätzlich', 'darüber hinaus',
            'folglich', 'dennoch', 'obwohl', 'inzwischen', 'anschließend',
        ],
        'readability_formula': 'wiener',
    },
    'es': {
        'stop_words': {
            'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'es',
            'son', 'era', 'eran', 'ser', 'estar', 'de', 'en', 'con', 'por', 'para',
            'que', 'como', 'pero', 'si', 'no', 'se', 'su', 'sus', 'mi', 'tu',
            'yo', 'nosotros', 'ellos', 'ellas', 'este', 'esta', 'estos', 'estas',
            'al', 'del', 'le', 'les', 'lo', 'también', 'ya', 'cuando', 'donde',
        },
        'first_person_pattern': r'\b(yo|nosotros|mi|mío|nuestro|nuestra)\b',
        'cta_patterns': ['comprar ahora', 'regístrate', 'empieza gratis', 'prueba gratis'],
        'boilerplate_patterns': ['lorem ipsum', 'próximamente', 'en construcción'],
        'time_sensitive_words': ['actualmente', 'ahora', 'hoy', 'último'],
        'citation_patterns': [r'según', r'estudio de', r'investigadores muestran'],
        'author_bio_patterns': [r'sobre el autor', r'escrito por', r'perfil del autor'],
        'transition_words': [
            'sin embargo', 'por lo tanto', 'además', 'asimismo', 'no obstante',
            'en consecuencia', 'aunque', 'mientras tanto', 'posteriormente',
        ],
        'readability_formula': 'fernandez_huerta',
    },
}

# Alias for backward compatibility in tokenize default
STOP_WORDS = LANGUAGE_PROFILES['en']['stop_words']


def detect_language(text, profiles):
    """Return the language code with the most stop-word hits."""
    words = set(re.findall(r'\b[a-zA-Z]{2,}\b', text.lower()))
    scores = {lang: len(words & profile['stop_words']) for lang, profile in profiles.items()}
    return max(scores, key=scores.get, default='en')
