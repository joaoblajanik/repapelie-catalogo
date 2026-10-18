# Segurança — Repapelie

## Arquitetura e fronteiras de confiança

- O navegador é não confiável. Toda alteração administrativa passa por rotas protegidas no servidor.
- Dados públicos do catálogo são uma projeção limitada dos registros de produto.
- A configuração do número de WhatsApp é controlada pela área administrativa; os campos do cliente não podem definir o destinatário.
- O catálogo não recebe nem armazena a mensagem do cliente; prepara uma URL `https://wa.me/` para envio manual.
- Produtos e configurações são persistidos em `data/store.json`; imagens em `data/uploads/`.

## Controles implementados

- Senha administrativa armazenada com `scrypt` e salt aleatório; sem credencial padrão.
- Cadastro inicial bloqueado após o primeiro administrador e exige `ADMIN_INITIAL_SETUP_TOKEN` forte configurado no ambiente.
- Sessão aleatória em cookie `HttpOnly`, `SameSite=Strict`, `Secure` em produção, com expiração de oito horas e logout.
- Atraso/bloqueio progressivo após tentativas de login inválidas por endereço IP.
- Autorização de sessão no servidor para operações administrativas.
- Checagem de origem configurável e restrição por origem em produção quando o cabeçalho Origin existe; CORS não é usado como autenticação.
- Limite de JSON de 1,5 MB e imagem de 4 MB; allowlist JPEG/PNG/WebP com verificação de assinatura básica, nome aleatório e armazenamento fora de diretório público estático.
- Validação de campos, enums, categorias, SKU, preços em centavos, opções, quantidades e comprimento de texto.
- Consultas SQL não se aplicam nesta versão: não há banco SQL.
- Renderização de texto no cliente usa escape HTML; cabeçalhos CSP, `nosniff`, `X-Frame-Options` e `Referrer-Policy` são enviados.
- `.env`, banco JSON e uploads estão excluídos do Git por `.gitignore`.

## Ameaças e limitações

| Ameaça | Mitigação atual | Limitação / próximo passo |
|---|---|---|
| Acesso administrativo indevido | Senha derivada, sessão e autorização de servidor | Adicionar MFA e gestão segura de sessão persistente para produção |
| CSRF | `SameSite=Strict` e checagem de Origin configurável | Implementar token CSRF dedicado e exigir Origin/Fetch Metadata em toda mutação |
| XSS | Escape de strings no frontend, CSP e `nosniff` | Executar varredura automatizada e reprocessar imagens; validar todos os contextos de saída |
| Upload malicioso | Limite, assinatura de formato e nome aleatório | Reprocessar/decode imagem, limitar dimensões/pixels e verificar conteúdo real |
| Brute force | Limitação temporária após falhas | Limite em memória reinicia com processo; usar armazenamento compartilhado/limitação na borda |
| Corrupção de dados | Escrita temporária e rename | JSON não é banco transacional; migrar para SQLite/PostgreSQL e backups |
| Perda de sessão | Token aleatório e expiração | Sessões ficam em memória e terminam ao reiniciar |
| Falsificação de preço | Recalcular com produto atual do catálogo | Estimativas no cliente não são vinculantes; confirmação comercial manual |
| Destinatário WhatsApp adulterado | Número vem da configuração administrativa retornada pela API pública | Número é público por natureza; verificar antes de compartilhar o site |
| Vazamento de dados | Sem persistência de solicitações; campos opcionais | Revisar logs e políticas de retenção da hospedagem |
| Perda de imagens | Arquivos no diretório de dados | Confirmar persistência do host e automatizar backup |

## Operação segura

1. Use HTTPS em produção e defina `NODE_ENV=production` e `TRUSTED_ORIGIN` para a origem exata.
2. Defina token de configuração temporário forte, crie o administrador e remova/rotacione o token depois do bootstrap.
3. Restrinja permissões dos arquivos de dados; nunca sirva `data/` por um servidor estático separado.
4. Faça backup de `data/store.json` e `data/uploads/` e teste restauração.
5. Mantenha Node.js atualizado e execute testes antes de cada publicação.
6. Não use os dados demonstrativos como inventário real.

## Verificação executada

Os resultados dos testes e comandos devem ser consultados no `TEST-REPORT.md`. Não foi realizada auditoria de penetração, revisão independente, certificação OWASP, avaliação jurídica ou deploy externo. Nenhum desses resultados deve ser inferido a partir da existência deste documento.
