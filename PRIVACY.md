# Privacidade e LGPD — Repapelie

## Dados tratados

- Dados de catálogo: produtos, categorias, configurações e dados necessários à conta administrativa.
- Dados do administrador: nome de usuário, salt e hash da senha, além de eventos administrativos limitados.
- Dados de solicitação: nome, telefone, data desejada, observações, itens, quantidades e opções. São montados no navegador e não são enviados ao servidor do catálogo.
- Armazenamento local: a lista do cliente pode ser guardada no `localStorage` do navegador até ser limpa pelo cliente ou pelo navegador.

## Finalidade e compartilhamento

Os dados da solicitação servem para compor uma mensagem que o cliente escolhe abrir e enviar manualmente ao número de WhatsApp configurado pela loja. Se o cliente enviar a mensagem, o tratamento passa também pelo WhatsApp e pelos serviços envolvidos, conforme seus próprios termos e políticas.

## Retenção e exclusão

O servidor não armazena solicitações dos clientes nesta versão. Dados administrativos e do catálogo persistem em `data/store.json`; imagens em `data/uploads/`. O responsável pela operação deve definir acesso, retenção, backups e exclusão segura desses arquivos no ambiente de hospedagem. O cliente pode limpar sua lista pelo botão correspondente ou apagar o armazenamento local do site no navegador.

## Minimização e cuidados

Campos de identificação são opcionais. Não solicite CPF, documentos, senhas, dados de cartão ou outras informações sensíveis pelo formulário. Fotos de referência de clientes não são aceitas nesta versão. Imagens e textos enviados em campos de personalização não devem ser reutilizados para publicidade sem autorização adequada.

## Responsabilidade e revisão

Contato de privacidade: a ser preenchido pelo responsável da loja nas configurações. O responsável deve revisar as finalidades reais, base legal, avisos, medidas de segurança, prazos de retenção e canais de atendimento conforme a LGPD e a legislação de defesa do consumidor. Este documento é uma descrição técnica inicial, não um parecer jurídico nem uma garantia de conformidade.
