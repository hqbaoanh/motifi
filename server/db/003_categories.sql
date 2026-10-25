-- Reference data: the category tree and the keyword rules the categorizer uses.

INSERT INTO categories (id, name, parent_id) VALUES
    (1,  'Income',         NULL),
    (2,  'Food',           NULL),
    (3,  'Groceries',      2),
    (4,  'Restaurants',    2),
    (5,  'Coffee',         2),
    (6,  'Transport',      NULL),
    (7,  'Transit',        6),
    (8,  'Rideshare',      6),
    (9,  'Fuel',           6),
    (10, 'Housing',        NULL),
    (11, 'Rent',           10),
    (12, 'Utilities',      10),
    (13, 'Shopping',       NULL),
    (14, 'Subscriptions',  NULL),
    (15, 'Health',         NULL),
    (16, 'Transfers',      NULL),
    (17, 'Uncategorized',  NULL)
ON CONFLICT DO NOTHING;

SELECT setval('categories_id_seq', (SELECT max(id) FROM categories));

INSERT INTO category_rules (keyword, category_id) VALUES
    ('payroll', 1), ('salary', 1), ('deposit', 1),
    ('safeway', 3), ('costco', 3), ('superstore', 3), ('nofrills', 3), ('supermarket', 3), ('walmart', 3),
    ('mcdonalds', 4), ('subway', 4), ('ramen', 4), ('pho', 4), ('sushi', 4), ('doordash', 4), ('ubereats', 4),
    ('starbucks', 5), ('timhortons', 5), ('blenz', 5), ('jjbean', 5),
    ('translink', 7), ('compass', 7),
    ('uber', 8), ('lyft', 8),
    ('chevron', 9), ('esso', 9), ('petrocanada', 9), ('shell', 9),
    ('rent', 11), ('landlord', 11),
    ('bchydro', 12), ('fortisbc', 12), ('telus', 12), ('rogers', 12),
    ('amazon', 13), ('ikea', 13), ('bestbuy', 13), ('uniqlo', 13),
    ('netflix', 14), ('spotify', 14), ('icloud', 14), ('youtube', 14),
    ('pharmacy', 15), ('shoppers', 15), ('londondrugs', 15),
    ('etransfer', 16), ('transfer', 16)
ON CONFLICT DO NOTHING;
