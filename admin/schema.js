/* Describes every editable field. The admin form is generated from this list,
 * so adding a field here (and rendering it in js/site.js) is all it takes to make it editable.
 *
 * Field types: text, textarea, number, color, toggle, icon, image, images, list (of strings),
 *              items (of objects), group (collapsible set of fields), note (static help text).
 */
(function () {
  'use strict';

  var text = function (path, label, o) { return Object.assign({ type: 'text', path: path, label: label }, o); };
  var area = function (path, label, o) { return Object.assign({ type: 'textarea', path: path, label: label }, o); };
  var toggle = function (path, label, o) { return Object.assign({ type: 'toggle', path: path, label: label }, o); };
  var color = function (path, label, o) { return Object.assign({ type: 'color', path: path, label: label }, o); };
  var image = function (path, label, o) { return Object.assign({ type: 'image', path: path, label: label }, o); };

  var sizeDefaults = { name: '', diameter: '', height: '', weight: '', capacity: '', price: 0 };

  window.ADMIN_SCHEMA = [
    {
      id: 'hero', title: 'עמוד ראשי', icon: '🏠',
      fields: [
        text('hero.title', 'כותרת ראשית'),
        area('hero.subtitle', 'כותרת משנה', { rows: 2 }),
        text('hero.primaryCta', 'כפתור ראשי (פותח וואטסאפ)'),
        text('hero.secondaryCta', 'כפתור משני (קופץ לדגמים)'),
        image('hero.image', 'תמונה ראשית'),
        text('hero.imageAlt', 'תיאור התמונה (לנגישות וגוגל)')
      ]
    },
    {
      id: 'why', title: 'למה לבחור בנו', icon: '⭐',
      fields: [
        toggle('why.enabled', 'להציג את הקטע הזה באתר'),
        text('why.kicker', 'כותרת קטנה'),
        text('why.title', 'כותרת הקטע'),
        {
          type: 'items', path: 'why.items', label: 'יתרונות', addLabel: 'הוספת יתרון', max: 8,
          itemTitle: function (it) { return it.title; },
          defaults: { icon: 'star', title: '', text: '' },
          fields: [
            { type: 'icon', path: 'icon', label: 'אייקון' },
            text('title', 'כותרת'),
            area('text', 'תיאור', { rows: 3 })
          ]
        },
        text('why.shipping', 'שורת משלוח (תגית מתחת ליתרונות)')
      ]
    },
    {
      id: 'catalog', title: 'דגמים ומחירים', icon: '🏕️',
      intro: 'כאן עורכים את הדגמים, הגדלים והמחירים. המחירים מוזנים ללא מע״מ — האתר מחשב את המחיר כולל מע״מ אוטומטית.',
      fields: [
        text('catalog.kicker', 'כותרת קטנה'),
        text('catalog.title', 'כותרת הקטע'),
        text('catalog.subtitle', 'תת-כותרת'),
        {
          type: 'group', title: 'הגדרות מע״מ ותוויות', fields: [
            toggle('catalog.vatEnabled', 'להציג מתג מע״מ'),
            { type: 'number', path: 'catalog.vatRate', label: 'אחוז מע״מ', min: 0, max: 100, step: 0.5 },
            text('catalog.vatLabel', 'טקסט ליד המתג'),
            text('catalog.vatOff', 'כפתור "ללא מע״מ"'),
            text('catalog.vatOn', 'כפתור "כולל מע״מ"'),
            text('catalog.noteExcl', 'הערה ליד מחיר (ללא מע״מ)'),
            text('catalog.noteIncl', 'הערה ליד מחיר (כולל מע״מ)'),
            text('catalog.specLabels.diameter', 'שם השדה: קוטר'),
            text('catalog.specLabels.height', 'שם השדה: גובה'),
            text('catalog.specLabels.weight', 'שם השדה: משקל'),
            text('catalog.specLabels.capacity', 'שם השדה: קיבולת')
          ]
        },
        {
          type: 'items', path: 'models', label: 'דגמים', addLabel: 'הוספת סוג אוהל חדש', min: 1, max: 6, confirmDelete: true,
          itemTitle: function (it) { return it.title; },
          defaults: function () {
            return {
              id: 'm' + Date.now().toString(36), navLabel: 'דגם חדש', kicker: 'דגם חדש', title: 'דגם חדש', subtitle: 'המפרט המלא', cta: 'להזמנה',
              features: [], photos: [], sizes: [Object.assign({}, sizeDefaults, { name: 'דגם 1M' })], fitTitle: 'למי מתאים?', fit: []
            };
          },
          fields: [
            text('navLabel', 'שם בתפריט העליון'),
            text('kicker', 'כותרת קטנה'),
            text('title', 'כותרת הדגם'),
            text('subtitle', 'תת-כותרת'),
            text('cta', 'טקסט כפתור ההזמנה'),
            { type: 'list', path: 'features', label: 'תגיות מאפיינים', addLabel: 'הוספת מאפיין' },
            { type: 'images', path: 'photos', label: 'גלריית תמונות', addLabel: 'הוספת תמונה', max: 8 },
            {
              type: 'items', path: 'sizes', label: 'גדלים ומחירים', addLabel: 'הוספת גודל', min: 1,
              itemTitle: function (it) { return it.name + (it.price ? ' · ₪' + Number(it.price).toLocaleString('en-US') : ''); },
              defaults: sizeDefaults,
              fields: [
                text('name', 'שם הגודל (המילה האחרונה מופיעה בעיגול, למשל "לוטוס 4M")'),
                text('diameter', 'קוטר'),
                text('height', 'גובה'),
                text('weight', 'משקל'),
                text('capacity', 'קיבולת'),
                { type: 'number', path: 'price', label: 'מחיר בש״ח (ללא מע״מ)', min: 0, step: 50 }
              ]
            },
            text('fitTitle', 'כותרת "למי מתאים"'),
            { type: 'list', path: 'fit', label: 'למי מתאים', addLabel: 'הוספת שורה', textarea: true }
          ]
        }
      ]
    },
    {
      id: 'included', title: 'מה כלול', icon: '📦',
      fields: [
        toggle('included.enabled', 'להציג את הקטע הזה באתר'),
        text('included.kicker', 'כותרת קטנה'),
        text('included.title', 'כותרת הקטע'),
        { type: 'list', path: 'included.items', label: 'מה כלול ברכישה', addLabel: 'הוספת פריט' },
        image('included.image', 'תמונה'),
        text('included.imageAlt', 'תיאור התמונה')
      ]
    },
    {
      id: 'banner', title: 'באנר משלוח', icon: '🚚',
      fields: [
        toggle('banner.enabled', 'להציג את הבאנר'),
        text('banner.title', 'כותרת'),
        text('banner.text', 'טקסט'),
        text('banner.cta', 'טקסט כפתור')
      ]
    },
    {
      id: 'contact', title: 'פרטי קשר ותחתית', icon: '☎️',
      fields: [
        text('contact.whatsapp', 'מספר וואטסאפ', { ltr: true, help: 'אפשר לכתוב 0515490099 או 972515490099 — האתר ידאג לפורמט.' }),
        text('contact.whatsappMessage', 'הודעה מוכנה בוואטסאפ (לא חובה)', { help: 'הטקסט שיופיע מוכן בשדה ההודעה כשלקוח לוחץ על הכפתור.' }),
        text('contact.phone', 'טלפון להצגה', { ltr: true }),
        text('contact.email', 'אימייל', { ltr: true }),
        text('contact.hours', 'שעות פעילות'),
        text('contact.website', 'כתובת האתר הראשי (הלוגו מקשר אליה)', { ltr: true }),
        { type: 'group', title: 'תחתית האתר', fields: [
          text('footer.brand', 'שם העסק'),
          text('footer.tagline', 'סלוגן'),
          text('footer.contactTitle', 'כותרת "צרו קשר"'),
          image('footer.logo', 'לוגו בתחתית', { png: true, maxSize: 600 })
        ] },
        { type: 'group', title: 'תפריט עליון וכפתור צף', fields: [
          image('nav.logo', 'לוגו בראש הדף', { png: true, maxSize: 800 }),
          text('nav.button', 'כפתור בתפריט'),
          text('nav.why', 'שם הקישור "למה אנחנו"'),
          text('nav.included', 'שם הקישור "מה כלול"'),
          text('nav.contact', 'שם הקישור "צרו קשר"'),
          toggle('floatingButton.enabled', 'להציג כפתור וואטסאפ צף'),
          text('floatingButton.text', 'טקסט הכפתור הצף')
        ] }
      ]
    },
    {
      id: 'design', title: 'צבעים וגוגל', icon: '🎨',
      fields: [
        { type: 'group', title: 'צבעי האתר', open: true, fields: [
          color('theme.bg', 'צבע רקע'),
          color('theme.text', 'צבע טקסט'),
          color('theme.green', 'צבע ראשי (כפתורים וקישורים)'),
          color('theme.brown', 'צבע כותרות'),
          color('theme.orange', 'צבע הדגשה'),
          color('theme.orangeDark', 'צבע הדגשה כהה (מחירים וכותרות קטנות)'),
          { type: 'reset', label: 'החזרת הצבעים למקור', path: 'theme' }
        ] },
        { type: 'group', title: 'קידום בגוגל (SEO)', open: true, fields: [
          text('meta.title', 'כותרת הדף (מופיעה בלשונית ובגוגל)'),
          area('meta.description', 'תיאור קצר לגוגל', { rows: 3, help: 'עד ~155 תווים.' })
        ] }
      ]
    }
  ];
})();
