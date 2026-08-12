-- Quatro correções que nascem do mesmo diagnóstico: o Compêndio foi populado por
-- extração via IA (modelo barato) a partir dos canais do Discord, e o que entrou
-- ficou pela metade e com o campo `atributo` em texto humano ("(Intuição)",
-- "(Percepção/Intuição)", "..."). Como o <select> do editor só tem os 8 slugs
-- canônicos, nenhum desses valores casava com uma opção e o navegador exibia a
-- primeira — era por isso que TODA perícia aparecia como "Força".
--
-- 1. `personagem` ganha `raca` e `oficio`: as regras fazem a raça mudar o combate
--    (Ogro reduz 30% do dano recebido, Lunariano alterna duas formas, Mink tem
--    Sulong), e sem esse dado a IA de balanceamento não tinha como acertar.
-- 2. `personagem_pericia.nivel` sai: perícia nunca teve nível neste sistema.
-- 3. `atributo` passa a guardar lista de slugs separados por vírgula
--    ("percepcao,intuicao") — perícia pode responder a mais de um atributo, o que
--    as próprias regras já diziam ("Força e/ou Percepção"). Sem tabela nova: o
--    precedente do projeto é `habilidade.campos_extras`, que também serializa
--    estrutura dentro de uma coluna.
-- 4. Compêndio completado a partir das notas de regra (#pericias, #vantagens,
--    #desvantagens). Todo INSERT é guardado por NOT EXISTS porque `nome` não é
--    UNIQUE — mesma idempotência do import do v1.
--
-- Preservado de propósito: os itens que só existem nas fichas e não nas regras
-- (Amaldiçoado, Mal-encarado, Corpo Vigoroso (Evoluido), Condição
-- Rara(Doença das Trevas), Perca parcial de paladar, Impulsivo, Falta de Sorte...).
-- Nada aqui toca `personagem_pericia`/`personagem_vantagem`/`personagem_desvantagem`
-- além do DROP COLUMN: dado de personagem não se mexe sem pedido.

-- ---------------------------------------------------------------- 1. raça/ofício
ALTER TABLE personagem ADD COLUMN raca   TEXT NOT NULL DEFAULT '';
ALTER TABLE personagem ADD COLUMN oficio TEXT NOT NULL DEFAULT '';

-- -------------------------------------------------------- 2. perícia sem nível
-- Coluna simples (sem índice nem constraint), então o DROP COLUMN do SQLite
-- 3.35+ basta — o bundle atual (libsqlite3-sys 0.30) é 3.46.
ALTER TABLE personagem_pericia DROP COLUMN nivel;

-- ------------------------------------------- 3. atributo canônico das 35 atuais
-- Uma linha por perícia, com o atributo que a nota #pericias declara. Explícito
-- de propósito: parsear "(Percepção/Intuição)" em SQL seria pior que enumerar.
UPDATE catalogo_pericia SET atributo = 'percepcao'            WHERE nome = 'Caça';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Conhecimentos Gerais';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Carpintaria';
UPDATE catalogo_pericia SET atributo = 'percepcao'            WHERE nome = 'Noção de Batalha';
UPDATE catalogo_pericia SET atributo = 'percepcao'            WHERE nome = 'Analisar Criatura';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Medicina';
UPDATE catalogo_pericia SET atributo = 'forca,percepcao'      WHERE nome = 'Arrombamento';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Culinária';
UPDATE catalogo_pericia SET atributo = 'agilidade'            WHERE nome = 'Flexibilidade';
UPDATE catalogo_pericia SET atributo = 'espirito'             WHERE nome = 'Prestidigitação';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Nutrição';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Primeiros Socorros';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Toxicologia';
UPDATE catalogo_pericia SET atributo = 'agilidade'            WHERE nome = 'Acrobacia';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'História Perdida';
UPDATE catalogo_pericia SET atributo = 'agilidade,espirito'   WHERE nome = 'Furtividade';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Navegação';
UPDATE catalogo_pericia SET atributo = 'agilidade'            WHERE nome = 'Atletismo';
UPDATE catalogo_pericia SET atributo = 'percepcao'            WHERE nome = 'Pesca';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Pilotagem';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Marcenaria';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Anatomia';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Botânica';
UPDATE catalogo_pericia SET atributo = 'percepcao,intuicao'   WHERE nome = 'Falsificação';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Engenharia';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Geografia';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Ciências Proibidas';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Física';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Atuação';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Costura';
UPDATE catalogo_pericia SET atributo = 'percepcao,intuicao'   WHERE nome = 'Ilusionismo';
UPDATE catalogo_pericia SET atributo = 'forca,intuicao'       WHERE nome = 'Forja';
UPDATE catalogo_pericia SET atributo = 'intuicao'             WHERE nome = 'Mecânica';
UPDATE catalogo_pericia SET atributo = 'carisma'              WHERE nome = 'Dança';
-- Disfarce aparece duas vezes na nota, com atributos diferentes (Carisma na
-- primeira ocorrência, Intuição/Percepção na segunda). Fica a última; a
-- divergência está reportada pra decisão do mestre.
UPDATE catalogo_pericia SET atributo = 'intuicao,percepcao'   WHERE nome = 'Disfarce';

-- As duas únicas com descrição de placeholder ("..."): texto real das regras.
UPDATE catalogo_pericia
   SET descricao = 'Ato de diligencia que consiste no ingresso em imóveis e abertura de móveis, fechados, mediante ordem judicial, a fim de encontrar coisas ou pessoas para apreensão.'
 WHERE nome = 'Arrombamento' AND trim(descricao) IN ('', '...');
UPDATE catalogo_pericia
   SET descricao = 'Habilidade de identificar, cultivar e utilizar plantas para diversos fins, como medicina, venenos ou alimentação. Inclui o conhecimento de ecossistemas e a capacidade de encontrar plantas raras.'
 WHERE nome = 'Botânica' AND trim(descricao) IN ('', '...');

-- ------------------------------------------ 4a. as 12 perícias que faltavam
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Criação de Projéteis', 'Possui facilidade na criação de projeteis de tipo variados de materiais.', 'percepcao,intuicao'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Criação de Projéteis');
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Meteorologia', 'Você sabe prever o clima nos dias ou momentos seguintes.', 'intuicao'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Meteorologia');
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Natação', 'Você sabe nadar em todos os estilos possíveis, além de conseguir mergulhar com os equipamentos adequados e fazer apneia para prolongar o fôlego.', 'agilidade'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Natação');
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Pintura', 'Você sabe desenhar e pintar, criando bandeiras ou belos quadros que podem lhe render dinheiro.', 'intuicao'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Pintura');
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Sedução', 'Você sabe fingir sentimentos românticos com relação à vítima além de conseguir ser sensual e atrativo. É como lábia e intimidação, mas utiliza a sensualidade.', 'espirito'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Sedução');
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Veterinária', 'Você pode fazer diagnósticos, prestar primeiros socorros e fazer cirurgias em animais. Funciona como Medicina, mas apenas para animais.', 'intuicao'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Veterinária');
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Zoologia', 'Você consegue analisar os animais no que se refere à sua biologia, genética, fisiologia, anatomia, ecologia, geografia e evolução.', 'intuicao'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Zoologia');
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Cirurgia', 'Você se torna apto a fazer tratamentos mais complexos, capazes de tratar tanto feridas profundas como doenças muito graves.', 'intuicao'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Cirurgia');
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Lógica', 'Em suma, a lógica serve para se pensar corretamente.', 'intuicao'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Lógica');
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Química', 'Habilidade de manipular substâncias químicas para criar poções, explosivos, venenos e outros compostos. Inclui o conhecimento de reações químicas e segurança no manuseio de materiais perigosos.', 'intuicao'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Química');
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Criptografia', 'Capacidade de criar e decifrar códigos e mensagens secretas. Inclui o conhecimento de técnicas de criptografia e a habilidade de proteger informações sensíveis.', 'intuicao'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Criptografia');
INSERT INTO catalogo_pericia (nome, descricao, atributo)
SELECT 'Instrumentos Musicais', 'Habilidade de tocar e compor música usando diversos instrumentos. Inclui o conhecimento de teoria musical e técnicas de performance.', 'intuicao'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_pericia WHERE nome = 'Instrumentos Musicais');

-- ---------------------------------------- 4b. as 17 vantagens que faltavam
-- `efeito` é a linha em negrito da nota (a regra mecânica). Onde a nota não dá
-- efeito mecânico, fica vazio — é assim nas regras, não é dado faltando.
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Álter Ego Heroico', 'Você possui uma identidade secreta, à sua escolha, que pode ser invocada sempre que estiver em perigo, desde que esteja com seus trajes de herói em mãos. Quando vestido de herói, deve proteger sua verdadeira identidade de todos.', 'Enquanto vestido de herói, recebe vantagem em jogadas de Agilidade e é sempre o primeiro agir em uma batalha.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Álter Ego Heroico');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Aparência Inofensiva', 'Por algum motivo você não parece perigoso. Talvez pareça muito pequeno, muito fraco, uma menininha segurando um pirulito. Você escolhe o motivo. Além de outros benefícios, como não levantar suspeitas, possuir esta individualidade também ajuda em combates, pegando oponentes desprevenidos. O truque não funciona com ninguém que já tenha visto você lutar, e também não engana duas vezes a mesma pessoa.', 'Recebe vantagem para acertar alguém que não desconfie de você, usando esta individualidade. Recebe vantagem em testes de furtividade.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Aparência Inofensiva');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Atleta', 'Você sempre gostou de praticar esportes, sempre foi muito bom em qualquer um que se dispusesse a praticar e pode até ter certa fama em um esporte específico.', 'Você recebe vantagem em Testes de Agilidade (Atletismo).'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Atleta');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Aura Assassina', 'Você emana uma presença intimidadora, que não tem nada a ver com sua aparência física, seja por já ter matado incontáveis pessoas ou talvez por possuir uma grande fúria contida dentro de si.', 'Você recebe vantagem em Teste de Espírito (Intimidação).'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Aura Assassina');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Emotivo', 'Você se sensibiliza facilmente com a dor dos outros e qualquer história triste o faz chorar. Isso faz com que sua interação seja mais fácil e que os outros sintam confiança em suas palavras e seus consolos.', 'Recebe vantagem em Testes de Carisma para lidar com pessoas amigáveis.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Emotivo');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Frieza', 'Seu personagem possui um grande controle das emoções, mesmo que você perca um braço, seja insultado ou veja um amigo morrendo, consegue conter suas emoções e continuar a agir com racionalidade.', 'Recebe vantagem em Testes contra Intuição (Provocação).'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Frieza');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Homem das Neves', 'O personagem é habituado à neve e ao gelo, sofre menos penalidades com temperaturas severamente baixas e conhecimento para se abrigar (fazer iglus) e proteger durante nevascas, ou pescar em lagos congelados.', 'Neste terreno, o personagem recebe vantagem em todos os Testes de Resistência.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Homem das Neves');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Homem das Selvas', 'O personagem sabe como sobreviver em uma floresta ou selva, evitando seus perigos naturais e extraindo dela o que precisa para sobreviver. Isso inclui habilidades de caça e pesca, subir em árvores, dentre outras.', 'Neste terreno, o personagem recebe vantagem em todos os Testes de Resistência.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Homem das Selvas');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Homem dos Mares', 'O personagem é habituado ao mar, mas não como um pirata ou qualquer guerreiro. Ele foi um pescador, um ajudante, um marujo simples em alto-mar. Sofre menos ao lidar com tempestades, ondas, e outros efeitos climáticos que afetam os navios.', 'Neste terreno, o personagem recebe vantagem em todos os Testes de Resistência, jogadas de acerto e dano e o período de descanso curto e longo são reduzidos pela metade.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Homem dos Mares');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Imunidade', 'Seu corpo resiste naturalmente aos microrganismos que provocam doenças. Você nunca pegará uma doença ou infecção “naturalmente”. Se você for inoculado à força, seu corpo fará o possível para expulsar os agentes o mais rápido possível.', 'Você possui vantagens ao fazer Testes de Resistência contra doenças.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Imunidade');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Instintos Animais', 'Talvez você tenha crescido em um local com culturas tribais ou em meio aos animais, talvez tenha combatido muitas feras, durante sua vida, ou só nasceu assim. O fato é que você se parece muito com um animal, às vezes, e têm instintos de sobrevivência aflorados.', 'Sempre que uma criatura assumida como inimiga estiver no seu campo de visão, você pode fazer Teste de Intuição para saber se ele é mais fraco, igualmente forte ou mais forte que você.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Instintos Animais');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Invisibilidade', 'Você pode ficar invisível, não literalmente, apenas tem uma presença sútil e calma. Fora de um combate, pode usar esta habilidade durante quanto tempo desejar contanto que permaneça praticamente imóvel.', 'Você recebe vantagem em testes de furtividade e facilidade de se esconder.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Invisibilidade');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Negativo', 'Você é negativo por natureza, sempre é pessimista e sempre espera o pior. Quando algo dá errado, você simplesmente aceita. Por definição nada que alguém faça, diga ou mesmo habilidades de Akuma no Mi podem deixar você depressivo ou sem querer agir, pois, não tem como ficar pior do que já é.', 'Você é imune às condições Apaixonado, Empoderado, Enfeitiçado, Enfurecido, Letárgico, Paralisado e Sonolento. Contudo essa é uma vantagem/desvantagem, pode ocorrer situações que você abaixa a moral do time.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Negativo');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Olhos de Águia', 'Você possui olhos que não podem ser enganados e que enxergam perfeitamente até onde sua vista alcança podendo ler e identificar mesmo as menores letras e símbolos.', 'Você tem vantagem em Testes de Percepção relacionados à visão.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Olhos de Águia');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Resistência a Venenos', 'Em algum momento de sua vida, o personagem foi exposto a venenos perigosos e se recuperou, criando anticorpos para combatê-lo. Graças a isso, ele possui uma resistência maior a venenos, porém não é totalmente imune, podendo apresentar sintomas reduzidos ou parciais para venenos fortes.', 'Você possui vantagem em Testes de Resistência contra venenos.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Resistência a Venenos');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Resistência ao Álcool', 'Por algum motivo você adquiriu uma resistência maior ao álcool do que pessoas normais, podendo resistir aos efeitos da embriaguez.', 'Você tem vantagem em Testes de Resistência contra a condição “Bêbado”.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Resistência ao Álcool');
INSERT INTO catalogo_vantagem (nome, descricao, efeito)
SELECT 'Senso de Direção Impecável', 'Você possui uma bússola no cérebro. Nunca se perde, mesmo em labirintos ou castelos, sabe sempre de que lado fica o norte e de onde você veio.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_vantagem WHERE nome = 'Senso de Direção Impecável');

-- ------------------------------------- 4c. as 29 desvantagens que faltavam
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Audição Ruim', 'Sua audição é reduzida por um defeito genético, sequela de uma batalha ou algum outro motivo.', 'Você tem desvantagem em Testes de Percepção que envolvam a Audição.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Audição Ruim');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Cleptomaníaco', 'Você rouba coisas de que não precisa, não por seu valor, apenas por serem interessantes. Sempre que surgir a chance de roubar algo, você irá roubar. Um cleptomaníaco nunca devolve para os donos o produto de seus roubos, e lutará para evitar que isso aconteça.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Cleptomaníaco');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Compulsivo', 'Existe algo que você precisa fazer constantemente e que lhe traz alguma gratificação emocional, normalmente um alívio de ansiedade e/ou angústia. São hábitos mal adaptativos que já foram executados inúmeras vezes e acontecem quase automaticamente. É comum que haja um "gatilho" ou situações que tragam sua compulsão à tona.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Compulsivo');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Convencido', 'Seu tópico de conversação favorito é você mesmo. Você sempre tenta levar todas as conversas para o tópico das suas conquistas e sucessos, e nunca falha em tentar receber o crédito por qualquer coisa com a qual esteja remotamente relacionado. Você não consegue evitar lembrar de seus feitos.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Convencido');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Curioso', 'Você simplesmente é curioso demais em um assunto específico, sempre que algo te chama atenção sobre ele, você sente uma vontade incontrolável para descobrir tudo que pode sobre o assunto, muitas vezes deixando para trás o seu bom senso.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Curioso');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Demente', 'Sua inteligência e capacidade de aprendizado são reduzidas. Por conta disso, não consegue aprender nada sozinho.', 'Você só consegue fazer treinamentos se houver um tutor para te ensinar, mesmo que o treinamento não especifique isso.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Demente');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Dependente', 'Você se sente totalmente inseguro quando não tem seus companheiros para te ajudar ou proteger, pode ser por medo, insegurança ou por sempre querer se mostrar.', 'Enquanto não estiver com nenhum companheiro ou criatura que esteja cooperando contigo, dentro do seu raio de visão, você recebe Desvantagem em todas as suas jogadas.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Dependente');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Distraído', 'Você tem dificuldade para se concentrar em alguma coisa. Consequentemente, seu personagem geralmente não possui o conhecimento necessário em várias situações.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Distraído');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Dívida de Jogo', 'Você deve uma quantidade absurda de dinheiro para uma ou várias personalidades muito poderosas e influentes, essa quantia é algo que você talvez nunca consiga pagar, além disso, os esforços de tentar passar seus credores para trás só aumentam a vontade de tentarem te pegar.', 'Independentemente de onde você esteja, você nunca está seguro e a qualquer momento podem surgir empregados e contratados dos seus credores para tentar te capturar.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Dívida de Jogo');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Falta de Sorte', 'A vida parece sempre querer rir da sua cara, não importa o quanto você tente e se prepare, alguma coisa sempre acaba dando errada.', 'O Mestre pode transformar um Teste bem sucedido em uma falha, esse sucesso pode ser sua ou de qualquer outro, desde que seja para atrapalhar sua vida.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Falta de Sorte');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Fantasioso', 'Você acredita ser alguém ou alguma coisa que não é, ou acha que pode fazer alguma coisa de que não é capaz. Fantasias são sustentadas pelas convicções do personagem, portanto não é uma boa ideia tentar o contrariar.', 'Sempre que alguém for contrário ou não acreditar na sua fantasia, você recebe a condição “Enfurecido” e ataca a criatura que discordou da sua fantasia.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Fantasioso');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Fúria Incontrolável', 'Tudo é capaz de te irritar e provocar sua fúria, desde ataques que te causem dor até uma provocação infantil e que seja obviamente uma armadilha.', 'Você recebe desvantagem em Testes de Intuição contra Testes de Habilidade de Espírito/Intuição (Provocação) e não pode ser acalmado.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Fúria Incontrolável');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Ganancioso', 'Você realmente ama dinheiro, talvez, o motivo que lhe fez partir para se aventurar nos mares. Sempre que alguém falar de formas de ganhar quantidades consideráveis de dinheiro, por um pedido, uma missão ou revelando a localização de um tesouro escondido, você não consegue resistir, caso perca a oportunidade, você é acometido por uma grande depressão.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Ganancioso');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Ingênuo', 'Talvez faltem alguns parafusos na sua cabeça, ou talvez você jamais tenha aprendido a separar a realidade da ficção. Não importa por que, você é extremamente vulnerável a mentiras sutis e meias-verdades.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Ingênuo');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Medroso', 'O medo é seu companheiro constante, qualquer coisa possivelmente assustadora o impressiona e faz com que esbugalhe os olhos e grite, mesmo que você seja capaz de fazer o mesmo ou até superar ou que a criatura seja mais fraca que você.', 'Você é sempre o último a agir.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Medroso');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Mentiroso', 'Você sempre tenta se sobressair com suas mentiras, sempre que tiver a oportunidade de parecer melhor do que você realmente é, não há hesitação, mesmo que faça com que um oponente mais poderoso se interesse em tirar sua vida. Chega a mentir tanto que começa a ser desacreditado.', 'Você recebe Desvantagem em Testes de Carisma (Enganação).'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Mentiroso');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Monstruoso', 'Sua aparência é repulsiva e assustadora. Você não pode sair pelas ruas como gente normal; as pessoas ficarão assustadas ou furiosas. Todos que possuem esta desvantagem, podem esconder sua monstruosidade com roupas adequadas.', 'Você recebe preconceito Severo.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Monstruoso');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Mudo', 'Um personagem mudo é incapaz de produzir fala, sendo preciso recorrer a outros meios para se comunicar, como a língua de sinais.', 'Você falha automaticamente em ações que dependam da fala.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Mudo');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Paranoico', 'Você não confia em ninguém, nem em seus amigos. Nunca pede e nem aceita nenhuma ajuda, nem mesmo o tratamento de seus ferimentos. Não consegue descansar ou dormir direito: mesmo que esteja em uma estalagem ou outro lugar que parece ser totalmente seguro.', 'Você precisa de um tempo para se acalmar e achar que está tudo certo, para começar um descanso curto ou longo.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Paranoico');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Sonâmbulo', 'Você pode começar a andar e falar enquanto dorme. Você pode até lutar e agir como se estivesse consciente, mas acorda se sofrer qualquer dano e não se lembra de nada que tenha acontecido enquanto estava sonâmbulo.', 'Ao final de cada descanso, você deve fazer um Teste de resistência para saber se conseguiu descansar. Em caso de falha, você não se beneficia de nenhuma característica de um descanso longo.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Sonâmbulo');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Sonolência', 'Por algum motivo você está sempre com sono, não importa se dormiu normalmente no dia anterior ou se acabou de dormir. Em qualquer momento, exceto, talvez, durante batalhas, você pode cair no sono.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Sonolência');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Sósia', 'Você é parecido com a descrição de outra pessoa, o que causa a confusão de identidades. Isso pode provocar inúmeras situações desagradáveis, ou mesmo perigosas, principalmente se o seu "outro eu" tiver péssima reputação ou estiver sendo procurado por algum crime.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Sósia');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Suicida', 'Você não dá valor à própria vida. Embora não tenha coragem para se matar, sempre procura oportunidades de morrer desafiando inimigos poderosos, correndo riscos desnecessários ou fazendo coisas de forma impensada.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Suicida');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Surdo', 'Você é totalmente surdo, incapaz de ouvir qualquer som. Isso pode ter ocorrido por um acidente, um ferimento antigo ou você nasceu assim.', 'Você falha automaticamente em Testes de Percepção que dependam da audição.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Surdo');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Timidez', 'Você sente uma dificuldade enorme em lidar com pessoas, mesmo que você seja amigo delas, e tenta evitar situações sociais sempre que possível.', 'Você recebe Desvantagem em Testes de Carisma (Atuação).'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Timidez');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Trapalhão', 'Sempre que você se move, sai esbarrando em tudo pela sua frente ou tropeça no nada, não consegue carregar qualquer coisa sem que tudo acabe no chão.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Trapalhão');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Vício', 'Você é viciado em alguma substância que precisa estar presente no seu sangue. Desde álcool, nicotina, açúcar, drogas ilícitas, alimentos comuns ou compostos mais simples.', ''
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Vício');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Visão Ruim', 'Você tem uma visão defeituosa devido a um problema incorrigível, por exemplo, ser caolho, míope ou enxergar mal por algum outro motivo, você pode usar óculos para corrigir, mas quando o deixa cair ou o perde, a dificuldade de enxergar é clara.', 'Você tem desvantagem em Testes de Percepção.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Visão Ruim');
INSERT INTO catalogo_desvantagem (nome, descricao, efeito)
SELECT 'Voz Fina', 'Você possui uma voz tão fina que chega a ser engraçada e não importa o quanto tente engrossar ou disfarçar e também não importa o seu tamanho ou aparência, nada impede que quem ouça sua voz ache a engraçada.', 'Você tem desvantagem em Testes de Espírito (Intimidação) com criaturas que possam te ouvir.'
 WHERE NOT EXISTS (SELECT 1 FROM catalogo_desvantagem WHERE nome = 'Voz Fina');

-- ------------------------------------------------------- 5. limpeza das notas
-- As notas 1–5 são a versão digitada à mão antes de o sync do Discord existir;
-- as #ficha/#mecânicas/#status/#ações-de-combate/#oficios que vêm do canal são a
-- fonte de verdade e já contêm o mesmo conteúdo. Casa por título e por ausência
-- de "#" pra não depender do id (o banco de outra máquina pode numerar diferente).
DELETE FROM nota
 WHERE titulo IN ('Ficha', 'Mecânicas', 'Status', 'Combate', 'Oficios')
   AND titulo NOT LIKE '#%';

-- `regras_notas` é a lista de notas que viram "REGRAS DO SISTEMA" no contexto da
-- IA. Estava com três defeitos: `#ficha` repetido (dois canais do Discord com o
-- mesmo nome), `#ficha` sendo na verdade uma ficha de exemplo preenchida — a
-- fonte mais direta de a IA inventar personagem — e `#dicas-do-mestre`, que é
-- etiqueta de mesa e cita as regras de OUTRO RPG ("o livro de regras do Ordem").
-- As duas notas continuam existindo para leitura; só saem do contexto da IA.
UPDATE config
   SET valor = '["#mecânicas","#status","#ações-de-combate","#oficios","#pericias","#vantagens","#desvantagens","#akuma-no-mi","#humano","#skypean","#tritões","#lunariano","#ogro","#mink"]',
       atualizado_em = datetime('now')
 WHERE chave = 'regras_notas';

-- ------------------------------------------- 6. raça/ofício dos personagens
-- Não é palpite: os 9 jogadores já declaravam raça e ofício nas primeiras linhas
-- do campo `descricao` (texto livre). Aqui esses dados só saem da prosa e entram
-- em coluna, que é o que permite a IA de balanceamento levá-los em conta.
-- A subespécie fica preservada porque `raca` é texto livre — "Mink (Raposa)" casa
-- com a nota de regra `#mink` do mesmo jeito que "Mink" casaria.
-- Só grava onde ainda está vazio, pra não sobrescrever edição feita na tela.
-- Os 6 NPCs ficam vazios de propósito: Lovecat (Barril, Polvora), aparição
-- (Portegeist), fera (Macaco Rei, Sea King) não são raça jogável, e a de
-- Bariarte a descrição não diz.
UPDATE personagem SET raca = 'Mink (Raposa)',      oficio = 'Artista'   WHERE nome = 'Aira'             AND raca = '';
UPDATE personagem SET raca = 'Humano',             oficio = 'Cozinheiro' WHERE nome = 'Guilherme'        AND raca = '';
UPDATE personagem SET raca = 'Skypean',            oficio = 'Médico'    WHERE nome = 'Harvey Solferino' AND raca = '';
UPDATE personagem SET raca = 'Tritão',             oficio = 'Cozinheiro' WHERE nome = 'Jimboy Segundo'   AND raca = '';
UPDATE personagem SET raca = 'Humano',             oficio = 'Gatuno'    WHERE nome = 'Kian'             AND raca = '';
UPDATE personagem SET raca = 'Mink (Cabra)',       oficio = 'Ferreiro'  WHERE nome = 'May D. Ark'       AND raca = '';
UPDATE personagem SET raca = 'Ogro',               oficio = 'Navegador' WHERE nome = 'Ryoko D. Violet'  AND raca = '';
UPDATE personagem SET raca = 'Lunariano (sem asas)', oficio = 'Gatuno'  WHERE nome = 'Siegfried'        AND raca = '';
-- Vagn Kane: a descrição tem DOIS cabeçalhos — o dele ("Idade: 21, Lunariano,
-- Ferreiro") e, colado abaixo, o do Siegfried ("Idade: 25, Lunariano (Sem asas),
-- Gatuno"). Vale o primeiro, e as perícias confirmam (Engenharia, Física, Forja,
-- Mecânica são as de Ferreiro). O texto duplicado na descrição fica como está —
-- é dado do mestre, não se mexe sem pedido.
UPDATE personagem SET raca = 'Lunariano',          oficio = 'Ferreiro'  WHERE nome = 'Vagn Kane'        AND raca = '';

-- ------------------------------- 7. atributo das perícias JÁ NAS FICHAS
-- A ficha copia nome/descrição/atributo por valor no momento em que a perícia é
-- escolhida no picker (ver repositorios.rs). Então corrigir só `catalogo_pericia`
-- arruma a tela do Compêndio e deixa as 33 perícias já salvas nas fichas com o
-- texto sujo de antes — e aí o editor não marca caixa nenhuma, trocando o bug
-- "aparece tudo como Força" por "não aparece atributo nenhum".
-- São 11 valores distintos no banco; enumerar é mais seguro que parsear em SQL.
--
-- Isto é normalização, não reinterpretação: cada valor virou o mesmo conjunto de
-- atributos que ele já significava. NÃO puxa o valor do catálogo pelo nome de
-- propósito — onde a ficha divergir das regras (ex.: Arrombamento está
-- 'Intuição' na ficha e 'forca,percepcao' nas regras), quem decide é o mestre,
-- não a migration.
UPDATE personagem_pericia SET atributo = 'intuicao'           WHERE atributo IN ('Intuição', '(Intuição)', 'intuição', '(intuição)');
UPDATE personagem_pericia SET atributo = 'percepcao'          WHERE atributo IN ('Percepção', '(Percepção)');
UPDATE personagem_pericia SET atributo = 'agilidade'          WHERE atributo IN ('Agilidade', '(Agilidade)');
UPDATE personagem_pericia SET atributo = 'carisma'            WHERE atributo IN ('Carisma', '(Carisma)');
UPDATE personagem_pericia SET atributo = 'forca'              WHERE atributo IN ('Força', '(Força)');
UPDATE personagem_pericia SET atributo = 'resistencia'        WHERE atributo IN ('Resistência', '(Resistência)');
UPDATE personagem_pericia SET atributo = 'espirito'           WHERE atributo IN ('Espírito', '(Espírito)');
UPDATE personagem_pericia SET atributo = 'determinacao'       WHERE atributo IN ('Determinação', '(Determinação)');
UPDATE personagem_pericia SET atributo = 'agilidade,espirito' WHERE atributo IN ('(Agilidade/Espírito)', 'Agilidade/Espírito');
UPDATE personagem_pericia SET atributo = 'percepcao,intuicao' WHERE atributo IN ('(Percepção/Intuição)', 'Percepção/Intuição');
UPDATE personagem_pericia SET atributo = 'forca,intuicao'     WHERE atributo IN ('(Força/Intuição)', 'Força/Intuição');
-- Placeholder de extração: melhor vazio (nenhuma caixa marcada, óbvio que falta
-- preencher) do que um atributo inventado.
UPDATE personagem_pericia SET atributo = '' WHERE trim(atributo) IN ('...', '-');
